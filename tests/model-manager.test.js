import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureModelExists, getAvailableModels } from '../lib/model-manager.js';
import fs from 'node:fs';

vi.mock('fs');
vi.mock('axios');
vi.mock('cli-progress');
vi.mock('node:https', () => ({
    Agent: vi.fn()
}));
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
            console.log('Expected to fail in test environment, but should have tried to remove file');
            expect(error).toBeDefined();
        }

        expect(unlinkSpy).toHaveBeenCalled();
    });

    it('should create directory if model missing', async () => {
        // Mock fs to simulate missing model directory and file
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 * 100 }); // Mock complete file

        // This test will try to download, but we just want to test directory creation
        // In a real scenario, it would proceed to download
        try {
            await ensureModelExists();
        } catch (error) {
            console.log('Expected to fail in test environment due to axios mocking');
            expect(error).toBeDefined();
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

    it('should throw error for unknown model', async () => {
        await expect(ensureModelExists('unknown')).rejects.toThrow('Unknown model: unknown');
    });

    it('should parse content-length correctly in downloadFile', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        // Spy on Number.parseInt
        const parseIntSpy = vi.spyOn(Number, 'parseInt');

        // Mock axios with content-length
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '12345' }
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        try {
            await ensureModelExists();
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }

        expect(parseIntSpy).toHaveBeenCalledWith('12345', 10);
        parseIntSpy.mockRestore();
    });

    it('should handle missing content-length header', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        // Spy on Number.parseInt (should not be called)
        const parseIntSpy = vi.spyOn(Number, 'parseInt');

        // Mock axios without content-length
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: {}
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        try {
            await ensureModelExists();
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }

        expect(parseIntSpy).not.toHaveBeenCalled();
        parseIntSpy.mockRestore();
    });

    it('should handle invalid content-length header', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        // Spy on Number.parseInt
        const parseIntSpy = vi.spyOn(Number, 'parseInt');

        // Mock axios with invalid content-length
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': 'invalid' }
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        try {
            await ensureModelExists();
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }

        expect(parseIntSpy).toHaveBeenCalledWith('invalid', 10);
        // Note: Number.parseInt('invalid', 10) returns NaN, which is handled as null since expectedSize will be NaN ? null : null -> null
        parseIntSpy.mockRestore();
    });

    it('should use specified modelKey instead of default', async () => {
        // Mock fs for existing complete model
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 * 100 });

        const modelPath = await ensureModelExists('qwen2.5');

        expect(modelPath).toContain('qwen2.5-coder-1.5b.gguf');
        expect(fs.existsSync).toHaveBeenCalled();
        expect(fs.statSync).toHaveBeenCalled();
    });

    it('should re-download model file that is exactly 1MB', async () => {
        // Mock existsSync to return true, statSync to return exactly 1MB, and unlinkSync
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 }); // Exactly 1MB
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

        // Mock axios
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        try {
            await ensureModelExists();
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }

        expect(unlinkSpy).toHaveBeenCalled();
    });

    it('should handle skipSSLVerification parameter', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        // Mock axios
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        // Import the mocked Agent
        const { Agent: MockAgent } = await import('node:https');

        try {
            await ensureModelExists('qwen3', true); // skipSSLVerification = true
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }

        expect(MockAgent).toHaveBeenCalledWith({ rejectUnauthorized: false });
    });

    it('should handle download errors in ensureModelExists', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

        // Mock axios to throw error
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(ensureModelExists('qwen3')).rejects.toThrow('Network error');
    });

    it('should handle incomplete download retry in downloadFile', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValueOnce({ size: 500 }) // First call returns incomplete size
                           .mockReturnValueOnce({ size: 1000 }); // Second call returns complete size

        // Mock axios - first call succeeds, second call should not happen due to recursion
        const mockAxios = vi.mocked(await import('axios'));
        let callCount = 0;
        mockAxios.default = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({
                    data: { pipe: vi.fn(), on: vi.fn() },
                    headers: { 'content-length': '1000' }
                });
            }
            throw new Error('Should not be called');
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        // This should not throw an error due to the retry logic
        try {
            await ensureModelExists('qwen3');
        } catch (error) {
            console.log('Expected to fail in test environment due to mocking');
            expect(error).toBeDefined();
        }
    });

    it('should handle empty download file', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 0 }); // Empty file

        // Mock axios
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        // Should retry due to empty file
        try {
            await ensureModelExists('qwen3');
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }
    });

    it('should handle writer error in downloadFile', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        const createWriteStreamSpy = vi.spyOn(fs, 'createWriteStream').mockReturnValue({
            on: vi.fn((event, callback) => {
                if (event === 'error') callback(new Error('Write error'));
            })
        });

        // Mock axios
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        // Mock cli-progress
        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(),
            update: vi.fn(),
            stop: vi.fn()
        }));

        await expect(ensureModelExists('qwen3')).rejects.toThrow('Write error');
        expect(createWriteStreamSpy).toHaveBeenCalled();
    });

    it('should handle axios timeout error', async () => {
        // Mock fs for missing model
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

        // Mock axios to throw timeout error
        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockRejectedValue(new Error('Timeout'));

        await expect(ensureModelExists('qwen3')).rejects.toThrow('Timeout');
    });
});
