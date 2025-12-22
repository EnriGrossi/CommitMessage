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

        it('should handle JSON parsing failure and warn in console', async () => {
            mSession.prompt.mockResolvedValue('{"refined_message": "test" invalid}');
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn());

            expect(consoleSpy).toHaveBeenCalledWith("Failed to parse grammar-enforced JSON", expect.any(Object));
            expect(result).toBe('{"refined_message": "test" invalid}');
        });

        it('should handle empty feedback gracefully', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            const result = await refineCommitMessage('/path/to/model', 'feat: original', '', 'diff content', vi.fn());

            expect(result).toBe('feat: test');
            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain('""'); // Empty feedback should still be in quotes
        });

        it('should handle very long feedback', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            const longFeedback = 'a'.repeat(1000) + ' make it better';
            const result = await refineCommitMessage('/path/to/model', 'feat: original', longFeedback, 'diff', vi.fn());

            expect(result).toBe('feat: test');
            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(longFeedback);
        });

        it('should handle special characters in feedback', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            const specialFeedback = 'make it "better" with quotes, apostrophes\' test & symbols < >';
            const result = await refineCommitMessage('/path/to/model', 'feat: original', specialFeedback, 'diff', vi.fn());

            expect(result).toBe('feat: test');
            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${specialFeedback}"`);
        });

        it('should handle different commit message types and refinement requests - fix to feat', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'test: refined' }));

            const original = 'fix: bug';
            const feedback = 'change to feat';

            await refineCommitMessage('/path/to/model', original, feedback, 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${original}"`);
            expect(promptArg).toContain(`"${feedback}"`);
        });

        it('should handle different commit message types and refinement requests - scope refinement', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'test: refined' }));

            const original = 'feat: add feature';
            const feedback = 'make scope more specific';

            await refineCommitMessage('/path/to/model', original, feedback, 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${original}"`);
            expect(promptArg).toContain(`"${feedback}"`);
        });

        it('should handle different commit message types and refinement requests - security focus', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'test: refined' }));

            const original = 'chore: update deps';
            const feedback = 'focus on security aspect';

            await refineCommitMessage('/path/to/model', original, feedback, 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${original}"`);
            expect(promptArg).toContain(`"${feedback}"`);
        });

        it('should use lower temperature for refinement (0.8 vs 1.0)', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: refined' }));

            await refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn());

            const promptCall = mSession.prompt.mock.calls[0];
            expect(promptCall[1]).toEqual({
                grammar: expect.any(Object),
                temperature: 0.8,
                maxTokens: 200,
                onToken: expect.any(Function)
            });
        });

        it('should handle multiline commit messages', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: refined' }));

            const multilineMessage = 'feat: add new feature\n\n- Added functionality A\n- Added functionality B';
            const feedback = 'make it shorter';

            await refineCommitMessage('/path/to/model', multilineMessage, feedback, 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${multilineMessage}"`);
        });

        it('should handle feat commit messages', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: refined' }));

            const original = 'feat: original message';
            await refineCommitMessage('/path/to/model', original, 'improve message', 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${original}"`);
        });

        it('should handle fix commit messages', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'fix: refined' }));

            const original = 'fix: original message';
            await refineCommitMessage('/path/to/model', original, 'improve message', 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${original}"`);
        });

        it('should handle docs commit messages', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'docs: refined' }));

            const original = 'docs: original message';
            await refineCommitMessage('/path/to/model', original, 'improve message', 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(`"${original}"`);
        });

        it('should prioritize user feedback in prompt instructions', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            await refineCommitMessage('/path/to/model', 'feat: original', 'change scope to api', 'diff', vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain('PRIORITY: The user\'s feedback is the PRIMARY directive');
            expect(promptArg).toContain('If the feedback requests a different focus (e.g., different file or feature), shift the message accordingly');
            expect(promptArg).toContain('If the feedback suggests a different type/scope, implement that change');
        });

        it('should maintain diff context for technical accuracy', async () => {
            mSession.prompt.mockResolvedValue(JSON.stringify({ refined_message: 'feat: test' }));

            const diffWithContext = `diff --git a/src/api.js b/src/api.js
@@ -1,5 +1,8 @@
+// New API endpoint
+app.get('/api/users', (req, res) => {
+  res.json({ users: [] });
+});
+
 function oldFunction() {`;

            await refineCommitMessage('/path/to/model', 'feat: add api', 'focus on the endpoint creation', diffWithContext, vi.fn());

            const promptArg = mSession.prompt.mock.calls[0][0];
            expect(promptArg).toContain(diffWithContext);
            expect(promptArg).toContain('Diff Context (for reference - use to validate technical accuracy)');
        });

        it('should handle model loading failures gracefully', async () => {
            mLlama.loadModel.mockRejectedValue(new Error('Model load failed'));

            await expect(refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn()))
                .rejects.toThrow('Model load failed');
        });

        it('should handle context creation failures', async () => {
            // Reset mocks to ensure clean state
            vi.clearAllMocks();
            mLlama.loadModel.mockResolvedValue(mModel);
            mModel.createContext.mockRejectedValue(new Error('Context creation failed'));

            await expect(refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn()))
                .rejects.toThrow('Context creation failed');
        });

        it('should handle session creation failures', async () => {
            // Reset mocks to ensure clean state
            vi.clearAllMocks();
            mLlama.loadModel.mockResolvedValue(mModel);
            mModel.createContext.mockResolvedValue(mContext);

            mockLlamaChatSession.mockImplementation(() => {
                throw new Error('Session creation failed');
            });

            await expect(refineCommitMessage('/path/to/model', 'feat: original', 'feedback', 'diff', vi.fn()))
                .rejects.toThrow('Session creation failed');
        });


    });
});
