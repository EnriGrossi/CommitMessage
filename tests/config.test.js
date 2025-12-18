import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mock fs to avoid actual file operations
vi.mock('fs');

import { loadConfig, saveConfig, setSelectedModel, getSelectedModel } from '../lib/config.js';

// Import the mocked fs
const mockFs = vi.mocked(fs);

describe('Config Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset all mocks to default behavior
        mockFs.existsSync.mockReturnValue(false);
        mockFs.readFileSync.mockImplementation(() => {
            throw new Error('File not found');
        });
        mockFs.writeFileSync.mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('loadConfig', () => {
        it('should return default config when no config file exists', () => {
            mockFs.existsSync.mockReturnValue(false);

            const config = loadConfig();

            expect(config).toEqual({ selectedModel: 'qwen3' });
            expect(mockFs.existsSync).toHaveBeenCalled();
        });

        it('should load config from file when it exists', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify({ selectedModel: 'qwen2.5' }));

            const config = loadConfig();

            expect(config).toEqual({ selectedModel: 'qwen2.5' });
            expect(mockFs.readFileSync).toHaveBeenCalled();
        });

        it('should merge config with defaults when config file has partial data', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify({ someOtherSetting: 'value' }));

            const config = loadConfig();

            expect(config).toEqual({ selectedModel: 'qwen3', someOtherSetting: 'value' });
        });

        it('should return default config when JSON parsing fails', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('invalid json');

            // Spy on console.warn to check if it's called
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const config = loadConfig();

            expect(config).toEqual({ selectedModel: 'qwen3' });
            expect(consoleSpy).toHaveBeenCalledWith('Failed to load config, using defaults:', expect.any(String));

            consoleSpy.mockRestore();
        });
    });

    describe('saveConfig', () => {
        it('should save config to file', () => {
            const config = { selectedModel: 'qwen2.5', testSetting: 'value' };

            saveConfig(config);

            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('config.json'),
                JSON.stringify(config, null, 2)
            );
        });

        it('should handle save config error gracefully', () => {
            mockFs.writeFileSync.mockImplementation(() => {
                throw new Error('Write error');
            });

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            saveConfig({ selectedModel: 'qwen2.5' });

            expect(consoleSpy).toHaveBeenCalledWith('Failed to save config:', 'Write error');

            consoleSpy.mockRestore();
        });
    });

    describe('setSelectedModel', () => {
        it('should set selected model', () => {
            setSelectedModel('qwen2.5');

            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('config.json'),
                JSON.stringify({ selectedModel: 'qwen2.5' }, null, 2)
            );
        });
    });

    describe('getSelectedModel', () => {
        it('should get selected model from config', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify({ selectedModel: 'qwen2.5' }));

            const model = getSelectedModel();

            expect(model).toBe('qwen2.5');
        });
    });
});
