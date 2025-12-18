import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
    selectedModel: 'qwen3' // 'qwen3' or 'qwen2.5'
};

export function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(configData) };
        }
    } catch (error) {
        console.warn('Failed to load config, using defaults:', error.message);
    }
    return DEFAULT_CONFIG;
}

export function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Failed to save config:', error.message);
    }
}

export function setSelectedModel(model) {
    const config = loadConfig();
    config.selectedModel = model;
    saveConfig(config);
}

export function getSelectedModel() {
    const config = loadConfig();
    return config.selectedModel;
}
