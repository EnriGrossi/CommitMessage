#!/usr/bin/env node

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { ensureModelExists } from './lib/model-manager.js';
import { getStagedDiff, commitChanges } from './lib/git.js';
import { generateCommitMessage } from './lib/ai-local.js';

async function main() {
    console.log(chalk.bold.cyan('\n 🤖 Offline AI Commit Message Generator \n'));

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
        // 3. Generate Message
        let currentStage = 'Initializing AI...';
        const startTime = Date.now();
        const spinner = ora(currentStage).start();

        // Update spinner every second
        const timerInterval = setInterval(() => {
            const seconds = Math.floor((Date.now() - startTime) / 1000);
            let timeStr;
            if (seconds < 60) timeStr = `${seconds}s`;
            else {
                const mins = Math.floor(seconds / 60);
                const secs = seconds % 60;
                timeStr = `${mins}m ${secs}s`;
            }
            spinner.text = `${currentStage} [${timeStr}]`;
        }, 1000);

        const generatedMessage = await generateCommitMessage(modelPath, diff, (stage, detail) => {
            currentStage = detail;
            // Immediate update for responsiveness
            const seconds = Math.floor((Date.now() - startTime) / 1000);
            let timeStr = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
            spinner.text = `${currentStage} [${timeStr}]`;
        });

        clearInterval(timerInterval);
        const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
        spinner.succeed(`Generated in ${totalSeconds}s`);

        console.log(chalk.green('\n📝 Proposed Commit Message:'));
        console.log(chalk.bold.white(generatedMessage));
        console.log('');

        // 4. User Interaction
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { name: '✅ Commit with this message', value: 'commit' },
                    { name: '✏️  Edit message', value: 'edit' },
                    { name: '❌ Cancel', value: 'cancel' }
                ]
            }
        ]);

        if (action === 'commit') {
            await commitChanges(generatedMessage);
            console.log(chalk.green('✔ Committed successfully!'));
        } else if (action === 'edit') {
            const { newMessage } = await inquirer.prompt([
                {
                    type: 'editor',
                    name: 'newMessage',
                    message: 'Edit your commit message:',
                    default: generatedMessage,
                    waitUserInput: true
                }
            ]);

            if (newMessage && newMessage.trim()) {
                await commitChanges(newMessage.trim());
                console.log(chalk.green('✔ Committed successfully!'));
            } else {
                console.log(chalk.yellow('Commit cancelled (empty message).'));
            }
        } else {
            console.log(chalk.gray('Operation cancelled.'));
        }

    } catch (error) {
        if (error.message.includes('Not a git repository')) {
            console.error(chalk.red('❌ Error: Current directory is not a git repository.'));
        } else {
            console.error(chalk.red('❌ An error occurred:'), error);
        }
        process.exit(1);
    }
}

main();
