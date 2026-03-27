import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCommitMessage, refineCommitMessage } from '../lib/ai-local.js';

// Mock objects using vi.hoisted
const { mSession, mLlama, mContext, mModel, mockLlamaChatSession } = vi.hoisted(() => {
    const session = { prompt: vi.fn() };
    const context = { getSequence: vi.fn() };
    const model = { createContext: vi.fn().mockResolvedValue(context) };
    const llama = { loadModel: vi.fn().mockResolvedValue(model) };
    const chatSession = vi.fn(function () { return session; });

    return { mSession: session, mContext: context, mModel: model, mLlama: llama, mockLlamaChatSession: chatSession };
});

// Mock node-llama-cpp
vi.mock('node-llama-cpp', () => {
    return {
        getLlama: vi.fn().mockResolvedValue(mLlama),
        LlamaChatSession: mockLlamaChatSession,
        LlamaJsonSchemaGrammar: vi.fn(),
        LlamaLogLevel: {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        }
    };
});

describe('AI Local Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset default mock implementations after clearAllMocks
        mModel.createContext.mockResolvedValue(mContext);
        mLlama.loadModel.mockResolvedValue(mModel);
        mockLlamaChatSession.mockImplementation(function () { return mSession; });
    });

    it('generateCommitMessage should return parsed JSON message', async () => {
        const mockResponse = JSON.stringify({ commit_message: 'feat(auth): add login endpoint' });
        mSession.prompt.mockResolvedValue(mockResponse);

        const result = await generateCommitMessage('/path/to/model', 'diff content', vi.fn());

        expect(mLlama.loadModel).toHaveBeenCalledWith({ modelPath: '/path/to/model' });
        expect(mSession.prompt).toHaveBeenCalled();
        expect(result).toBe('feat(auth): add login endpoint');
    });

    it('should use digest for large diffs instead of raw diff', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'chore: update files' }));

        // Create a large diff with actual diff structure
        const largeDiff = `diff --git a/big-file.js b/big-file.js\n` + '+const x = 1;\n'.repeat(3000);
        await generateCommitMessage('model', largeDiff, vi.fn());

        const promptArg = mSession.prompt.mock.calls[0][0];
        // Large diffs should use the digest, which contains KEY CHANGES section
        expect(promptArg).toContain('KEY CHANGES:');
        expect(promptArg).toContain('big-file.js');
    });

    it('should sanitize non-conventional output and return fallback', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'just some random text' }));

        const diff = `diff --git a/src/main.js b/src/main.js
+console.log('hello');`;
        const result = await generateCommitMessage('/path/to/model', diff, vi.fn());

        // Should return a fallback conventional commit since model output is not valid
        expect(result).toMatch(/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)/);
    });

    it('should call onProgress callback with updates', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat(test): add tests' }));
        const onProgressSpy = vi.fn();

        await generateCommitMessage('/path/to/model', 'diff content', onProgressSpy);

        expect(onProgressSpy).toHaveBeenCalledWith('loading', expect.stringContaining('Model'));
        expect(onProgressSpy).toHaveBeenCalledWith('context', expect.stringContaining('Creating Context Window...'));
        expect(onProgressSpy).toHaveBeenCalledWith('analyzing', expect.stringContaining('Analyzing Diff'));
        expect(onProgressSpy).toHaveBeenCalledWith('generating', expect.stringContaining('Drafting message...'));
    });

    it('should handle JSON parsing failure and return fallback', async () => {
        mSession.prompt.mockResolvedValue('{"commit_message": "test" invalid}');
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const diff = `diff --git a/lib/config.js b/lib/config.js
+const x = 1;`;
        const result = await generateCommitMessage('/path/to/model', diff, vi.fn());

        // Should return a fallback since JSON is invalid and raw text is not conventional
        expect(result).toMatch(/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)/);
    });

    it('should extract file names from diff and include in prompt context', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat(src): add hello' }));

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

    it('should include analysis hints in prompt', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat(src): test' }));

        const diff = `diff --git a/src/api.js b/src/api.js
+const endpoint = '/users';
-const endpoint = '/old';`;

        await generateCommitMessage('/path/to/model', diff, vi.fn());

        const promptArg = mSession.prompt.mock.calls[0][0];
        // Should contain analysis hints
        expect(promptArg).toContain('Files changed:');
        expect(promptArg).toContain('additions');
        expect(promptArg).toContain('deletions');
    });

    it('should include few-shot examples in prompt', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat(api): add endpoint' }));

        await generateCommitMessage('/path/to/model', 'diff content', vi.fn());

        const promptArg = mSession.prompt.mock.calls[0][0];
        expect(promptArg).toContain('EXAMPLES:');
        expect(promptArg).toContain('feat(auth): add jwt token refresh logic');
    });

    it('should use temperature 0.6 for generation', async () => {
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat: test' }));

        await generateCommitMessage('/path/to/model', 'diff content', vi.fn());

        const promptCall = mSession.prompt.mock.calls[0];
        expect(promptCall[1]).toEqual(expect.objectContaining({
            temperature: 0.6,
            maxTokens: 100
        }));
    });

    it('should reuse cached model for refinement after generation', async () => {
        // Generate first
        mSession.prompt.mockResolvedValue(JSON.stringify({ commit_message: 'feat: first' }));
        await generateCommitMessage('/path/to/model', 'diff1', vi.fn());
        const loadCountAfterGenerate = mLlama.loadModel.mock.calls.length;

        // Refine with same model path — should reuse cache
        mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: refined' }));
        await refineCommitMessage('/path/to/model', 'feat: first', 'improve', 'diff1', vi.fn());

        // loadModel should not have been called again
        expect(mLlama.loadModel.mock.calls.length).toBe(loadCountAfterGenerate);
    });

    describe('refineCommitMessage', () => {
        it('should return parsed refined message', async () => {
            const mockResponse = JSON.stringify({ refined_message: 'feat(api): improved commit' });
            mSession.prompt.mockResolvedValue(mockResponse);

            const result = await refineCommitMessage('/path/to/model', 'feat: original', 'make it more specific', 'diff content', vi.fn());

            expect(mSession.prompt).toHaveBeenCalled();
            expect(result).toBe('feat(api): improved commit');
        });

        it('should use digest for large diffs in refinement', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            const largeDiff = `diff --git a/big-file.js b/big-file.js\n` + '+const y = 2;\n'.repeat(2000);
            await refineCommitMessage('model', 'feat: original', 'feedback', largeDiff, vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain('KEY CHANGES:');
            expect(promptArg).toContain('big-file.js');
        });

        it('should call onProgress callback with refinement updates', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));
            const onProgressSpy = vi.fn();

            await refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', onProgressSpy);

            expect(onProgressSpy).toHaveBeenCalledWith('context', expect.stringContaining('Creating Context Window...'));
            expect(onProgressSpy).toHaveBeenCalledWith('refining', expect.stringContaining('Refining message based on feedback...'));
        });

        it('should include original message and feedback in prompt', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            await refineCommitMessage('/path/to/model', 'feat: add feature', 'make it more descriptive', 'diff content here', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain('"feat: add feature"');
            expect(promptArg).toContain('"make it more descriptive"');
            expect(promptArg).toContain('diff content here');
        });

        it('should fall back to original message on invalid JSON', async () => {
            mSession.prompt.mockResolvedValue('totally broken json');
            vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn());

            // Should fall back to original since output is not conventional and not parseable
            expect(result).toBe('feat: original');
        });

        it('should use temperature 0.5 for refinement', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: refined' }));

            await refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn());

            const promptCall = mSession.prompt.mock.calls[0];
            expect(promptCall[1]).toEqual(expect.objectContaining({
                temperature: 0.5,
                maxTokens: 100
            }));
        });

        it('should handle model loading failures gracefully', async () => {
            mLlama.loadModel.mockRejectedValue(new Error('Model load failed'));

            await expect(refineCommitMessage('/new/model/path', 'feat: original', 'feedback', 'diff', vi.fn()))
                .rejects.toThrow('Model load failed');
        });

        it('should handle context creation failures', async () => {
            mModel.createContext.mockRejectedValue(new Error('Context creation failed'));

            await expect(refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn()))
                .rejects.toThrow('Context creation failed');
        });

        it('should handle session creation failures', async () => {
            mockLlamaChatSession.mockImplementation(() => {
                throw new Error('Session creation failed');
            });

            await expect(refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn()))
                .rejects.toThrow('Session creation failed');
        });
    });
});
