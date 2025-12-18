import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureModelExists, getAvailableModels } from '../lib/model-manager.js';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('axios');
vi.mock('cli-progress');
vi.mock('../lib/config.js', () => ({
    getSelectedModel: vi.fn(() => 'qwen3')
}));

describe('Model Manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return model path if it exists and is complete', async () => {
        // Mock existsSync to return true and statSync to return a large file size
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 * 100 }); // 100MB

        const modelPath = await ensureModelExists();

        // Should contain the qwen3 model filename
        expect(modelPath).toContain('qwen3-4b.gguf');
        expect(fs.existsSync).toHaveBeenCalled();
        expect(fs.statSync).toHaveBeenCalled();
    });

    it('should remove and re-download incomplete model file', async () => {
        // Mock existsSync to return true, statSync to return small file size, and unlinkSync
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 }); // Small incomplete file
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

        // Mock axios for download
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = {
            get: vi.fn().mockResolvedValue({
                data: { pipe: vi.fn(), on: vi.fn() },
                headers: { 'content-length': '1000' }
            })
        };

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        try {
            await ensureModelExists();
        } catch (error) {
            // Expected to fail in test environment, but should have tried to remove file
        }

        expect(unlinkSpy).toHaveBeenCalled();
    });

    it('should create directory if model missing', async () => {
        // Mock fs to simulate missing model directory and file
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        const statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 * 100 }); // Mock complete file

        // This test will try to download, but we just want to test directory creation
        // In a real scenario, it would proceed to download
        try {
            await ensureModelExists();
        } catch (error) {
            // Expected to fail in test environment due to axios mocking
        }

        expect(mkdirSpy).toHaveBeenCalled();
    });

    it('should get available models', () => {
        const models = getAvailableModels();
        expect(models).toHaveLength(2);
        expect(models[0]).toHaveProperty('key', 'qwen3');
        expect(models[0]).toHaveProperty('name', 'Qwen 3 4B');
        expect(models[0]).toHaveProperty('filename', 'qwen3-4b.gguf');
        expect(models[1]).toHaveProperty('key', 'qwen2.5');
        expect(models[1]).toHaveProperty('name', 'Qwen2.5-Coder-1.5B');
        expect(models[1]).toHaveProperty('filename', 'qwen2.5-coder-1.5b.gguf');
    });
});
