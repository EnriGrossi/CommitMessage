#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { ensureModelExists, getAvailableModels, detectHardware, recommendModel } from './lib/model-manager.js';
import { getStagedDiff, commitChanges } from './lib/git.js';
import { generateCommitMessage, refineCommitMessage } from './lib/ai-local.js';
import { setSelectedModel, getSelectedModel } from './lib/config.js';

const program = new Command();

// Format timing breakdown for display
function formatTiming(timing) {
    if (!timing) return '';
    const labels = {
        loading: '📦 Model load',
        context: '🧠 Context',
        analyzing: '🔍 Analysis',
        generating: '✍️  Generation',
        refining: '✍️  Refinement'
    };
    const parts = [];
    for (const [key, ms] of Object.entries(timing)) {
        if (key === 'total' || key === 'tokens') continue;
        const label = labels[key] || key;
        parts.push(`${label}: ${(ms / 1000).toFixed(1)}s`);
    }
    if (timing.tokens) {
        parts.push(`🔤 Tokens: ${timing.tokens}`);
    }
    return parts.join('  │  ');
}

// Default command - generate commit message
program
    .name('ai-commit')
    .description('Offline AI Commit Message Generator')
    .version('1.0.0')
    .action(async () => {
        console.log(chalk.bold.cyan('\n 🤖 Offline AI Commit Message Generator \n'));

        // Show current model
        const currentModel = getAvailableModels().find(m => m.key === getSelectedModel());
        console.log(chalk.blue(`📋 Using model: ${currentModel?.name || 'Unknown'}`));

        // Show hardware recommendation hint if using a suboptimal model
        const { key: recommendedKey } = recommendModel();
        if (currentModel && recommendedKey !== currentModel.key) {
            const recommendedModel = getAvailableModels().find(m => m.key === recommendedKey);
            console.log(chalk.yellow(`💡 Tip: Run "ai-commit auto-select" to use ${recommendedModel?.name || recommendedKey} (recommended for your hardware)`));
        }
        console.log('');

        try {
            // 1. Ensure Model Exists
            // limit spinner usage here as the download has its own progress bar
            const modelPath = await ensureModelExists();

            // 2. Get Staged Diff
            const diff = await getStagedDiff();
            if (!diff || diff.trim().length === 0) {
                console.log(chalk.yellow('ℹ️  No staged changes found. Use "git add" to stage files first.'));
                return;
            }

            // 3. Generate Message
            let currentStage = 'Initializing AI...';
            const globalStartTime = Date.now();
            const spinner = ora(currentStage).start();

            // Update spinner every second
            const timerInterval = setInterval(() => {
                const globalSeconds = Math.floor((Date.now() - globalStartTime) / 1000);
                let globalTimeStr;
                if (globalSeconds < 60) globalTimeStr = `${globalSeconds}s`;
                else {
                    const mins = Math.floor(globalSeconds / 60);
                    const secs = globalSeconds % 60;
                    globalTimeStr = `${mins}m ${secs}s`;
                }
                spinner.text = `${currentStage} [${globalTimeStr}]`;
            }, 1000);

            const result = await generateCommitMessage(modelPath, diff, (stage, detail) => {
                currentStage = detail;
            });

            clearInterval(timerInterval);
            const totalSeconds = ((Date.now() - globalStartTime) / 1000).toFixed(1);
            spinner.succeed(`Generated in ${totalSeconds}s`);
            console.log(chalk.dim(`  ${formatTiming(result.timing)}`));

            let currentMessage = result.message;
            let continueLoop = true;

            while (continueLoop) {
                console.log(chalk.green('\n📝 Proposed Commit Message:'));
                console.log(chalk.bold.white(currentMessage));
                console.log('');

                // 4. User Interaction
                const { action } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'action',
                        message: 'What would you like to do?',
                        choices: [
                            { name: '✅ Commit with this message', value: 'commit' },
                            { name: '🔄 Regenerate message', value: 'regenerate' },
                            { name: '💬 Suggest improvements', value: 'suggest' },
                            { name: '✏️  Edit message', value: 'edit' },
                            { name: '❌ Cancel', value: 'cancel' }
                        ]
                    }
                ]);

                if (action === 'commit') {
                    await commitChanges(currentMessage);
                    console.log(chalk.green('✔ Committed successfully!'));
                    continueLoop = false;
                } else if (action === 'regenerate') {
                    console.log(chalk.cyan('🔄 Regenerating commit message...\n'));
                    const spinner = ora('Initializing AI...').start();
                    const regenerateStartTime = Date.now();

                    // Update spinner every second
                    const timerInterval = setInterval(() => {
                        const globalSeconds = Math.floor((Date.now() - globalStartTime) / 1000);
                        let globalTimeStr = globalSeconds < 60 ? `${globalSeconds}s` : `${Math.floor(globalSeconds / 60)}m ${globalSeconds % 60}s`;
                        spinner.text = `Regenerating... [${globalTimeStr}]`;
                    }, 1000);

                    currentMessage = await generateCommitMessage(modelPath, diff, (stage, detail) => {
                        const globalSeconds = Math.floor((Date.now() - globalStartTime) / 1000);
                        let globalTimeStr = globalSeconds < 60 ? `${globalSeconds}s` : `${Math.floor(globalSeconds / 60)}m ${globalSeconds % 60}s`;
                        spinner.text = `${detail} [${globalTimeStr}]`;
                    }, { regenerate: true });

                    clearInterval(timerInterval);
                    const regenerateSeconds = ((Date.now() - regenerateStartTime) / 1000).toFixed(1);
                    spinner.succeed(`Regenerated in ${regenerateSeconds}s`);
                    console.log(chalk.dim(`  ${formatTiming(currentMessage.timing)}`));
                    currentMessage = currentMessage.message;
                } else if (action === 'suggest') {
                    const { feedback } = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'feedback',
                            message: 'What would you like to improve about this message?',
                            validate: (input) => input.trim().length > 0 || 'Please provide feedback to suggest improvements.'
                        }
                    ]);

                    if (feedback?.trim()) {
                        console.log(chalk.cyan('💬 Refining commit message based on your feedback...\n'));
                        const spinner = ora('Initializing AI...').start();
                        const suggestStartTime = Date.now();

                        // Update spinner every second
                        const timerInterval = setInterval(() => {
                            const globalSeconds = Math.floor((Date.now() - globalStartTime) / 1000);
                            let globalTimeStr = globalSeconds < 60 ? `${globalSeconds}s` : `${Math.floor(globalSeconds / 60)}m ${globalSeconds % 60}s`;
                            spinner.text = `Refining... [${globalTimeStr}]`;
                        }, 1000);

                        currentMessage = await refineCommitMessage(modelPath, currentMessage, feedback.trim(), diff, (stage, detail) => {
                            const globalSeconds = Math.floor((Date.now() - globalStartTime) / 1000);
                            let globalTimeStr = globalSeconds < 60 ? `${globalSeconds}s` : `${Math.floor(globalSeconds / 60)}m ${globalSeconds % 60}s`;
                            spinner.text = `${detail} [${globalTimeStr}]`;
                        });

                        clearInterval(timerInterval);
                        const suggestSeconds = ((Date.now() - suggestStartTime) / 1000).toFixed(1);
                        spinner.succeed(`Refined in ${suggestSeconds}s`);
                        console.log(chalk.dim(`  ${formatTiming(currentMessage.timing)}`));
                        currentMessage = currentMessage.message;
                    }
                } else if (action === 'edit') {
                    const { newMessage } = await inquirer.prompt([
                        {
                            type: 'editor',
                            name: 'newMessage',
                            message: 'Edit your commit message:',
                            default: currentMessage,
                            waitUserInput: true
                        }
                    ]);

                    if (newMessage?.trim()) {
                        await commitChanges(newMessage.trim());
                        console.log(chalk.green('✔ Committed successfully!'));
                        continueLoop = false;
                    } else {
                        console.log(chalk.yellow('Commit cancelled (empty message).'));
                        continueLoop = false;
                    }
                } else {
                    console.log(chalk.gray('Operation cancelled.'));
                    continueLoop = false;
                }
            }

        } catch (error) {
            if (error.message.includes('Not a git repository')) {
                console.error(chalk.red('❌ Error: Current directory is not a git repository.'));
            } else {
                console.error(chalk.red('❌ An error occurred:'), error);
            }
            process.exit(1);
        }
    });

// Set model command
program
    .command('set-model <model>')
    .description('Set the AI model to use for commit message generation')
    .option('--insecure', 'Skip SSL certificate verification during download')
    .action(async (model, options) => {
        const availableModels = getAvailableModels();
        const modelKeys = availableModels.map(m => m.key);

        if (!modelKeys.includes(model)) {
            console.log(chalk.red(`❌ Invalid model. Available models:`));
            availableModels.forEach(m => {
                console.log(chalk.yellow(`  - ${m.key}: ${m.name}`));
            });
            process.exit(1);
        }

        setSelectedModel(model);
        console.log(chalk.green(`✔ Model set to: ${availableModels.find(m => m.key === model).name}`));

        // Pre-download the model if not already downloaded
        try {
            console.log(chalk.blue('Checking if model is downloaded...'));
            await ensureModelExists(model, options.insecure);
            console.log(chalk.green('✔ Model is ready to use!'));
        } catch (error) {
            console.log(chalk.red('❌ Failed to download model:'), error.message);
            process.exit(1);
        }
    });

// Auto-select model based on hardware
program
    .command('auto-select')
    .description('Detect hardware and automatically select the best model')
    .option('--insecure', 'Skip SSL certificate verification during download')
    .action(async (options) => {
        console.log(chalk.bold.cyan('\n 🔍 Hardware Detection \n'));

        const { key, config, hardware, warning } = recommendModel();

        console.log(chalk.blue('System Info:'));
        console.log(chalk.gray(`  CPU: ${hardware.cpuModel} (${hardware.cpuCores} cores)`));
        console.log(chalk.gray(`  RAM: ${hardware.totalRAMGB} GB total, ${hardware.freeRAMGB} GB free`));
        console.log(chalk.gray(`  OS:  ${hardware.platform} ${hardware.arch}`));
        console.log('');

        if (warning) {
            console.log(chalk.yellow(`⚠️  ${warning}`));
        }

        console.log(chalk.green(`✔ Recommended model: ${config.name} (${config.sizeGB} GB download)`));

        const currentModel = getSelectedModel();
        if (currentModel === key) {
            console.log(chalk.gray(`  Already selected.`));
        } else {
            setSelectedModel(key);
            console.log(chalk.green(`✔ Model set to: ${config.name}`));
        }

        // Pre-download
        try {
            console.log(chalk.blue('\nChecking if model is downloaded...'));
            await ensureModelExists(key, options.insecure);
            console.log(chalk.green('✔ Model is ready to use!'));
        } catch (error) {
            console.log(chalk.red('❌ Failed to download model:'), error.message);
            process.exit(1);
        }
    });

// Help command
program
    .command('help')
    .description('Show available commands')
    .action(() => {
        console.log(chalk.bold.cyan('\n 🤖 Offline AI Commit Message Generator \n'));
        console.log(chalk.bold('Available Commands:\n'));

        console.log(chalk.yellow('ai-commit (default)'));
        console.log('  Generate a commit message from staged changes\n');

        console.log(chalk.yellow('ai-commit set-model <model> [options]'));
        console.log('  Set the AI model to use. Available models:');
        const availableModels = getAvailableModels();
        availableModels.forEach(model => {
            console.log(chalk.gray(`    ${model.key}: ${model.name} (${model.sizeGB} GB, needs ${model.minRAM}+ GB RAM)`));
        });
        console.log(chalk.gray('  Options:'));
        console.log(chalk.gray('    --insecure    Skip SSL certificate verification during download'));
        console.log('');

        console.log(chalk.yellow('ai-commit auto-select [options]'));
        console.log('  Detect hardware and automatically select the best model');
        console.log(chalk.gray('  Options:'));
        console.log(chalk.gray('    --insecure    Skip SSL certificate verification during download'));
        console.log('');

        console.log(chalk.yellow('ai-commit help'));
        console.log('  Show this help message\n');

        console.log(chalk.yellow('ai-commit --version'));
        console.log('  Show version information\n');

        console.log(chalk.bold('Current selected model:'), chalk.green(getAvailableModels().find(m => m.key === getSelectedModel())?.name || 'Unknown'));
    });

program.parse();
