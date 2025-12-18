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

// Alternative Qwen3 sources - checking different repositories
const MODEL_URL = 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf';
const FALLBACK_MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf';

export async function ensureModelExists() {
    if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    if (fs.existsSync(MODEL_PATH)) {
        // Optionally verify size or hash here, but for now simple existence check.
        return MODEL_PATH;
    }

    // Try to download Qwen 3 4B first
    try {
        console.log(chalk.blue(`Model not found. Downloading Qwen 3 4B (Offline capable)...`));
        console.log(chalk.dim(`Source: ${MODEL_URL}`));

        await downloadFile(MODEL_URL, MODEL_PATH);
        console.log(chalk.green('\nQwen 3 4B downloaded successfully!'));
        return MODEL_PATH;
    } catch (error) {
        console.log(chalk.yellow(`\nFailed to download Qwen 3 4B: ${error.message}`));
        console.log(chalk.blue('Falling back to Qwen2.5-Coder-1.5B...'));
        console.log(chalk.dim(`Source: ${FALLBACK_MODEL_URL}`));

        await downloadFile(FALLBACK_MODEL_URL, MODEL_PATH);
        console.log(chalk.green('\nQwen2.5-Coder-1.5B downloaded successfully!'));
        return MODEL_PATH;
    }
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
