import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCommitMessage, refineCommitMessage } from '../lib/ai-local.js';

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
        vi.spyOn(console, 'warn').mockImplementation(() => { });

        // Create large diff > 24000 chars
        const largeDiff = 'a'.repeat(30000);
        await generateCommitMessage('model', largeDiff, vi.fn());

        // Check if prompt call contains truncated indicator
        const promptArg = mSession.prompt.mock.calls[0][0];
        expect(promptArg).toContain('(Diff truncated for performance)');
    });

    it('should handle invalid JSON response and return cleaned response', async () => {
        // Mock invalid JSON response
        mSession.prompt.mockResolvedValue('invalid json response');

        const result = await generateCommitMessage('/path/to/model', 'diff content', vi.fn());

        expect(result).toBe('invalid json response');
    });

    it('should call onProgress callback with updates', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat: test' }));
        const onProgressSpy = vi.fn();

        await generateCommitMessage('/path/to/model', 'diff content', onProgressSpy);

        // Should have called onProgress multiple times
        expect(onProgressSpy).toHaveBeenCalledWith('loading', expect.stringContaining('Loading AI Model...'));
        expect(onProgressSpy).toHaveBeenCalledWith('context', expect.stringContaining('Creating Context Window...'));
        expect(onProgressSpy).toHaveBeenCalledWith('analyzing', expect.stringContaining('Analyzing Diff'));
        expect(onProgressSpy).toHaveBeenCalledWith('generating', expect.stringContaining('Drafting message...'));
    });

    it('should handle JSON parsing failure and return cleaned response', async () => {
        // Mock response that looks like JSON but isn't
        mSession.prompt.mockResolvedValue('{"commit_message": "test" invalid}');
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await generateCommitMessage('/path/to/model', 'diff content', vi.fn());

        expect(consoleSpy).toHaveBeenCalledWith("Failed to parse grammar-enforced JSON", expect.any(Object));
        expect(result).toBe('{"commit_message": "test" invalid}');
    });

    it('should extract file names from diff correctly', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat: test' }));

        const diff = `diff --git a/src/main.js b/src/main.js
index 1234567..abcdef0 100644
--- a/src/main.js
+++ b/src/main.js
@@ -1,3 +1,4 @@
+console.log('hello');
 console.log('world');
diff --git a/test.js b/test.js
index abcdef0..1234567 100644
--- a/test.js
+++ b/test.js
@@ -1,3 +1,4 @@
+console.log('test');`;

        await generateCommitMessage('/path/to/model', diff, vi.fn());

        const promptArg = mSession.prompt.mock.calls[0][0];
        expect(promptArg).toContain('src/main.js');
        expect(promptArg).toContain('test.js');
    });

    it('should categorize files correctly', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat: test' }));

        const diff = `diff --git a/script.py b/script.py
diff --git a/config.json b/config.json
diff --git a/Dockerfile b/Dockerfile
diff --git a/.gitignore b/.gitignore
diff --git a/docs/README.md b/docs/README.md`;

        await generateCommitMessage('/path/to/model', diff, vi.fn());

        const promptArg = mSession.prompt.mock.calls[0][0];
        // The prompt should contain the diff content
        expect(promptArg).toContain('script.py');
        expect(promptArg).toContain('config.json');
        expect(promptArg).toContain('Dockerfile');
        expect(promptArg).toContain('.gitignore');
        expect(promptArg).toContain('docs/README.md');
    });

    it('should determine primary scope from file types', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat: test' }));

        // Test with multiple Python files
        const diff = `diff --git a/main.py b/main.py
diff --git a/utils.py b/utils.py
diff --git a/config.py b/config.py`;

        await generateCommitMessage('/path/to/model', diff, vi.fn());

        const promptArg = mSession.prompt.mock.calls[0][0];
        expect(promptArg).toContain('main.py');
    });

    describe('refineCommitMessage', () => {
        it('should return parsed refined message', async () => {
            const mockResponse = JSON.stringify({ refined_message: 'feat: improved commit' });
            mSession.prompt.mockResolvedValue(mockResponse);

            const result = await refineCommitMessage('/path/to/model', 'feat: original', 'make it more specific', 'diff content', vi.fn());

            expect(mLlama.loadModel).toHaveBeenCalledWith({ modelPath: '/path/to/model' });
            expect(mSession.prompt).toHaveBeenCalled();
            expect(result).toBe('feat: improved commit');
        });

        it('should handle truncation for large diffs in refinement', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            // Create large diff > 12000 chars
            const largeDiff = 'a'.repeat(15000);
            await refineCommitMessage('model', 'feat: original', 'feedback', largeDiff, vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain('(Diff truncated for performance)');
        });

        it('should call onProgress callback with refinement updates', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));
            const onProgressSpy = vi.fn();

            await refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', onProgressSpy);

            expect(onProgressSpy).toHaveBeenCalledWith('loading', expect.stringContaining('Loading AI Model for refinement...'));
            expect(onProgressSpy).toHaveBeenCalledWith('context', expect.stringContaining('Creating Context Window...'));
            expect(onProgressSpy).toHaveBeenCalledWith('refining', expect.stringContaining('Refining message based on feedback...'));
        });

        it('should include original message, feedback, and diff in prompt', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            const originalMessage = 'feat: add feature';
            const userFeedback = 'make it more descriptive';
            const diffContent = 'diff content here';

            await refineCommitMessage('/path/to/model', originalMessage, userFeedback, diffContent, vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${originalMessage}"`);
            expect(promptArg).toContain(`"${userFeedback}"`);
            expect(promptArg).toContain(diffContent);
            expect(promptArg).toContain('PRIORITY: The user\'s feedback is the PRIMARY directive');
        });

        it('should handle invalid JSON response and return cleaned response', async () => {
            mSession.prompt.mockResolvedValue('invalid json response');

            const result = await refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn());

            expect(result).toBe('invalid json response');
        });
    });
});
