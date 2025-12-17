import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import cliProgress from 'cli-progress';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'models');
const MODEL_FILENAME = 'model.gguf';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_FILENAME);

// Qwen2.5-Coder-1.5B with improved generation parameters
// Enhanced with higher temperature and randomness for better commit message variety
const MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf';

export async function ensureModelExists() {
    if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    if (fs.existsSync(MODEL_PATH)) {
        // Optionally verify size or hash here, but for now simple existence check.
        return MODEL_PATH;
    }

    console.log(chalk.blue(`Model not found. Downloading Qwen2.5-Coder-1.5B (Offline capable)...`));
    console.log(chalk.dim(`Source: ${MODEL_URL}`));

    await downloadFile(MODEL_URL, MODEL_PATH);
    console.log(chalk.green('\nModel downloaded successfully!'));

    return MODEL_PATH;
}

async function downloadFile(url, outputPath) {
    const writer = fs.createWriteStream(outputPath);

    const { data, headers } = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
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
