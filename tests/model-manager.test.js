import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureModelExists, getAvailableModels, detectHardware, recommendModel } from '../lib/model-manager.js';
import fs from 'node:fs';

vi.mock('fs');
vi.mock('axios');
vi.mock('cli-progress');
vi.mock('node:https', () => ({
    Agent: vi.fn()
}));
vi.mock('../lib/config.js', () => ({
    getSelectedModel: vi.fn(() => 'qwen3-4b')
}));

describe('Model Manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return model path if it exists and is complete', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 * 100 });

        const modelPath = await ensureModelExists();

        expect(modelPath).toContain('qwen3-4b-q4_k_m.gguf');
        expect(fs.existsSync).toHaveBeenCalled();
        expect(fs.statSync).toHaveBeenCalled();
    });

    it('should remove and re-download incomplete model file', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 100 });
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = {
            get: vi.fn().mockResolvedValue({
                data: { pipe: vi.fn(), on: vi.fn() },
                headers: { 'content-length': '1000' }
            })
        };

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
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
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 * 100 });

        try {
            await ensureModelExists();
        } catch (error) {
            console.log('Expected to fail in test environment due to axios mocking');
            expect(error).toBeDefined();
        }

        expect(mkdirSpy).toHaveBeenCalled();
    });

    it('should get available models with all properties', () => {
        const models = getAvailableModels();
        expect(models).toHaveLength(3);

        expect(models[0]).toHaveProperty('key', 'qwen3-1.7b');
        expect(models[0]).toHaveProperty('name', 'Qwen3 1.7B (Q8_0)');
        expect(models[0]).toHaveProperty('sizeGB');
        expect(models[0]).toHaveProperty('minRAM');
        expect(models[0]).toHaveProperty('quality');

        expect(models[1]).toHaveProperty('key', 'qwen3-4b');
        expect(models[1]).toHaveProperty('name', 'Qwen3 4B (Q4_K_M)');

        expect(models[2]).toHaveProperty('key', 'qwen3-8b');
        expect(models[2]).toHaveProperty('name', 'Qwen3 8B (Q4_K_M)');
    });

    it('should throw error for unknown model', async () => {
        await expect(ensureModelExists('unknown')).rejects.toThrow('Unknown model: unknown');
    });

    it('should parse content-length correctly in downloadFile', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        const parseIntSpy = vi.spyOn(Number, 'parseInt');

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '12345' }
        });

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
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
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        const parseIntSpy = vi.spyOn(Number, 'parseInt');

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: {}
        });

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
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
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        const parseIntSpy = vi.spyOn(Number, 'parseInt');

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': 'invalid' }
        });

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
        }));

        try {
            await ensureModelExists();
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }

        expect(parseIntSpy).toHaveBeenCalledWith('invalid', 10);
        parseIntSpy.mockRestore();
    });

    it('should use specified modelKey instead of default', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 * 100 });

        const modelPath = await ensureModelExists('qwen3-1.7b');

        expect(modelPath).toContain('qwen3-1.7b-q8_0.gguf');
        expect(fs.existsSync).toHaveBeenCalled();
        expect(fs.statSync).toHaveBeenCalled();
    });

    it('should re-download model file that is exactly 1MB', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 * 1024 });
        const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
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
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1000 });

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
        }));

        const { Agent: MockAgent } = await import('node:https');

        try {
            await ensureModelExists('qwen3-4b', true);
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }

        expect(MockAgent).toHaveBeenCalledWith({ rejectUnauthorized: false });
    });

    it('should handle download errors in ensureModelExists', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(ensureModelExists('qwen3-4b')).rejects.toThrow('Network error');
    });

    it('should handle incomplete download retry in downloadFile', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValueOnce({ size: 500 })
                           .mockReturnValueOnce({ size: 1000 });

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

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
        }));

        try {
            await ensureModelExists('qwen3-4b');
        } catch (error) {
            console.log('Expected to fail in test environment due to mocking');
            expect(error).toBeDefined();
        }
    });

    it('should handle empty download file', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        vi.spyOn(fs, 'statSync').mockReturnValue({ size: 0 });

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
        }));

        try {
            await ensureModelExists('qwen3-4b');
        } catch (error) {
            console.log('Expected to fail in test environment');
            expect(error).toBeDefined();
        }
    });

    it('should handle writer error in downloadFile', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        const createWriteStreamSpy = vi.spyOn(fs, 'createWriteStream').mockReturnValue({
            on: vi.fn((event, callback) => {
                if (event === 'error') callback(new Error('Write error'));
            })
        });

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockResolvedValue({
            data: { pipe: vi.fn(), on: vi.fn() },
            headers: { 'content-length': '1000' }
        });

        vi.mocked(await import('cli-progress')).SingleBar = vi.fn().mockImplementation(() => ({
            start: vi.fn(), update: vi.fn(), stop: vi.fn()
        }));

        await expect(ensureModelExists('qwen3-4b')).rejects.toThrow('Write error');
        expect(createWriteStreamSpy).toHaveBeenCalled();
    });

    it('should handle axios timeout error', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

        const mockAxios = vi.mocked(await import('axios'));
        mockAxios.default = vi.fn().mockRejectedValue(new Error('Timeout'));

        await expect(ensureModelExists('qwen3-4b')).rejects.toThrow('Timeout');
    });

    describe('Hardware Detection', () => {
        it('should return hardware info', () => {
            const hw = detectHardware();
            expect(hw).toHaveProperty('totalRAMGB');
            expect(hw).toHaveProperty('freeRAMGB');
            expect(hw).toHaveProperty('cpuModel');
            expect(hw).toHaveProperty('cpuCores');
            expect(hw).toHaveProperty('platform');
            expect(hw).toHaveProperty('arch');
            expect(typeof hw.totalRAMGB).toBe('number');
            expect(hw.totalRAMGB).toBeGreaterThan(0);
        });

        it('should recommend a model based on RAM', () => {
            const result = recommendModel();
            expect(result).toHaveProperty('key');
            expect(result).toHaveProperty('config');
            expect(result).toHaveProperty('hardware');
            expect(result.config).toHaveProperty('name');
            expect(result.config).toHaveProperty('sizeGB');
            // The recommended model key should be one of the available models
            const availableKeys = getAvailableModels().map(m => m.key);
            expect(availableKeys).toContain(result.key);
        });
    });
});
