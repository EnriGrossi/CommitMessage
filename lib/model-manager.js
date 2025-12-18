import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { getSelectedModel } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'models');

// Model configurations
const MODELS = {
    'qwen3': {
        filename: 'qwen3-4b.gguf',
        url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
        name: 'Qwen 3 4B'
    },
    'qwen2.5': {
        filename: 'qwen2.5-coder-1.5b.gguf',
        url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
        name: 'Qwen2.5-Coder-1.5B'
    }
};

export function getAvailableModels() {
    return Object.keys(MODELS).map(key => ({
        key,
        name: MODELS[key].name,
        filename: MODELS[key].filename
    }));
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

    if (fs.existsSync(modelPath)) {
        return modelPath;
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

    const { data, headers } = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        httpsAgent: skipSSLVerification ? new (await import('https')).Agent({
            rejectUnauthorized: false
        }) : undefined
    });

    const totalLength = headers['content-length'];

    const progressBar = new cliProgress.SingleBar({
        format: 'Downloading [{bar}] {percentage}% | {value}/{total} bytes | {speed} bytes/s',
    }, cliProgress.Presets.shades_classic);

    progressBar.start(parseInt(totalLength, 10), 0);
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
            // Verify size if Content-Length was available
            if (totalLength && stats.size < parseInt(totalLength, 10)) {
                console.log(chalk.red('\nDownload incomplete or corrupted. Retrying...'));
                fs.unlinkSync(outputPath);
                // Recursive retry
                await downloadFile(url, outputPath);
            }
            resolve();
        });
        writer.on('error', reject);
    });
}
