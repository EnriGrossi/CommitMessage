import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCommitMessage } from '../lib/ai-local.js';

// Mock objects using vi.hoisted
const { mSession, mLlama, mContext, mModel } = vi.hoisted(() => {
    const session = { prompt: vi.fn() };
    const context = { getSequence: vi.fn() };
    const model = { createContext: vi.fn().mockResolvedValue(context) };
    const llama = { loadModel: vi.fn().mockResolvedValue(model) };

    return { mSession: session, mContext: context, mModel: model, mLlama: llama };
});

// Mock node-llama-cpp
vi.mock('node-llama-cpp', () => {
    return {
        getLlama: vi.fn().mockResolvedValue(mLlama),
        LlamaChatSession: vi.fn(function () { return mSession; }), // Standard function for constructor logic
        LlamaJsonSchemaGrammar: vi.fn()
    };
});

describe('AI Local Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generateCommitMessage should return parsed JSON message', async () => {
        // Mock success response
        const mockResponse = JSON.stringify({ commit_message: 'feat: valid commit' });
        mSession.prompt.mockResolvedValue(mockResponse);

        const result = await generateCommitMessage('/path/to/model', 'diff content', vi.fn());

        expect(mLlama.loadModel).toHaveBeenCalledWith({ modelPath: '/path/to/model' });
        expect(mSession.prompt).toHaveBeenCalled();
        expect(result).toBe('feat: valid commit');
    });

    it('should handle truncation for large diffs', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'test' }));
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        // Create large diff > 24000 chars
        const largeDiff = 'a'.repeat(30000);
        await generateCommitMessage('model', largeDiff, vi.fn());

        // Check if prompt call contains truncated indicator
        const promptArg = mSession.prompt.mock.calls[0][0];
        expect(promptArg).toContain('(Diff truncated for performance)');
    });
});
