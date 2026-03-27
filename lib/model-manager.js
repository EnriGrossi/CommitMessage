import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { fileURLToPath } from 'node:url';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { getSelectedModel } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'models');

// Model configurations ordered by size (smallest to largest)
// RAM requirement ≈ model file size + ~1-2 GB overhead for context/runtime
const MODELS = {
    'qwen3-1.7b': {
        filename: 'qwen3-1.7b-q8_0.gguf',
        url: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf',
        name: 'Qwen3 1.7B (Q8_0)',
        sizeGB: 1.83,
        minRAM: 4,   // GB of total system RAM needed
        quality: 1    // relative quality score for commit messages
    },
    'qwen3-4b': {
        filename: 'qwen3-4b-q4_k_m.gguf',
        url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
        name: 'Qwen3 4B (Q4_K_M)',
        sizeGB: 2.5,
        minRAM: 8,
        quality: 2
    },
    'qwen3-8b': {
        filename: 'qwen3-8b-q4_k_m.gguf',
        url: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
        name: 'Qwen3 8B (Q4_K_M)',
        sizeGB: 5.03,
        minRAM: 12,
        quality: 3
    }
};

export function getAvailableModels() {
    return Object.keys(MODELS).map(key => ({
        key,
        name: MODELS[key].name,
        filename: MODELS[key].filename,
        sizeGB: MODELS[key].sizeGB,
        minRAM: MODELS[key].minRAM,
        quality: MODELS[key].quality
    }));
}

// Detect system hardware and return info
export function detectHardware() {
    const totalRAM = os.totalmem();
    const freeRAM = os.freemem();
    const cpus = os.cpus();
    const platform = os.platform();
    const arch = os.arch();

    return {
        totalRAMGB: Math.round(totalRAM / (1024 ** 3) * 10) / 10,
        freeRAMGB: Math.round(freeRAM / (1024 ** 3) * 10) / 10,
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCores: cpus.length,
        platform,
        arch
    };
}

// Recommend the best model based on available hardware
export function recommendModel() {
    const hw = detectHardware();
    const totalRAM = hw.totalRAMGB;

    // Pick the highest quality model that fits in RAM
    // We need the model file + ~2GB overhead for llama.cpp context + OS
    const candidates = Object.entries(MODELS)
        .filter(([, config]) => totalRAM >= config.minRAM)
        .sort((a, b) => b[1].quality - a[1].quality);

    if (candidates.length === 0) {
        // Even the smallest model might be tight, but try it anyway
        return { key: 'qwen3-1.7b', config: MODELS['qwen3-1.7b'], hardware: hw, warning: 'Low RAM detected. Performance may be slow.' };
    }

    const [key, config] = candidates[0];
    return { key, config, hardware: hw, warning: null };
}

export async function ensureModelExists(modelKey = null, skipSSLVerification = false) {
    if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    const selectedModel = modelKey || getSelectedModel();
    const modelConfig = MODELS[selectedModel];

    if (!modelConfig) {
        throw new Error(`Unknown model: ${selectedModel}`);
    }

    const modelPath = path.join(MODELS_DIR, modelConfig.filename);

    // Check if model exists and has content (not a partial/failed download)
    if (fs.existsSync(modelPath)) {
        const stats = fs.statSync(modelPath);
        // If file exists but is empty or very small (less than 1MB), consider it incomplete
        if (stats.size > 1024 * 1024) { // At least 1MB
            return modelPath;
        } else {
            // Remove incomplete file and re-download
            console.log(chalk.yellow(`⚠️  Found incomplete model file (${(stats.size / 1024 / 1024).toFixed(2)} MB), removing and re-downloading...`));
            fs.unlinkSync(modelPath);
        }
    }

    // Download the selected model
    console.log(chalk.blue(`Model not found. Downloading ${modelConfig.name} (Offline capable)...`));
    console.log(chalk.dim(`Source: ${modelConfig.url}`));
    if (skipSSLVerification) {
        console.log(chalk.yellow(`⚠️  SSL certificate verification disabled`));
    }

    try {
        await downloadFile(modelConfig.url, modelPath, skipSSLVerification);
        console.log(chalk.green(`\n${modelConfig.name} downloaded successfully!`));
        return modelPath;
    } catch (error) {
        console.log(chalk.red(`\nFailed to download ${modelConfig.name}: ${error.message}`));
        throw error;
    }
}

async function downloadFile(url, outputPath, skipSSLVerification = false) {
    const writer = fs.createWriteStream(outputPath);

    try {
        const { data, headers } = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            httpsAgent: skipSSLVerification ? new (await import('node:https')).Agent({
                rejectUnauthorized: false
            }) : undefined,
            timeout: 30000 // 30 second timeout
        });

        const totalLength = headers['content-length'];
        const expectedSize = totalLength ? Number.parseInt(totalLength, 10) : null;

        const progressBar = new cliProgress.SingleBar({
            format: 'Downloading [{bar}] {percentage}% | {value}/{total} bytes | {speed} bytes/s',
        }, cliProgress.Presets.shades_classic);

        progressBar.start(expectedSize || 0, 0);
        let downloaded = 0;
        let startTime = Date.now();

        data.on('data', (chunk) => {
            downloaded += chunk.length;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = downloaded / elapsed;

            progressBar.update(downloaded, {
                speed: Math.round(speed)
            });
        });

        data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                progressBar.stop();
                const stats = fs.statSync(outputPath);

                // Verify download completeness
                if (expectedSize && stats.size < expectedSize) {
                    console.log(chalk.red(`\nDownload incomplete: ${stats.size} / ${expectedSize} bytes. Retrying...`));
                    fs.unlinkSync(outputPath);
                    // Recursive retry
                    await downloadFile(url, outputPath, skipSSLVerification);
                } else if (stats.size === 0) {
                    console.log(chalk.red('\nDownloaded file is empty. Retrying...'));
                    fs.unlinkSync(outputPath);
                    await downloadFile(url, outputPath, skipSSLVerification);
                } else {
                    console.log(chalk.green(`Downloaded ${stats.size} bytes successfully.`));
                }
                resolve();
            });

            writer.on('error', (error) => {
                progressBar.stop();
                // Clean up partial file on error
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                reject(error);
            });
        });
    } catch (error) {
        // Clean up partial file on error
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }
        throw error;
    }
}
