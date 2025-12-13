import { fileURLToPath } from 'url';
import path from 'path';
import { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar } from "node-llama-cpp";
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function generateCommitMessage(modelPath, diff, onProgress) {
    const startTime = Date.now();
    const getElapsed = () => {
        const seconds = Math.floor((Date.now() - startTime) / 1000);
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    const updateProgress = (stage, message) => {
        if (onProgress) onProgress(stage, `${message} [${getElapsed()}]`);
    };

    updateProgress('loading', 'Loading AI Model...');
    const llama = await getLlama();
    const model = await llama.loadModel({
        modelPath: modelPath
    });

    updateProgress('context', 'Creating Context Window...');
    const context = await model.createContext();
    const session = new LlamaChatSession({
        contextSequence: context.getSequence()
    });

    const diffLines = diff.split('\n').length;
    const diffChars = diff.length;

    // Performance Optimization: Truncate very large diffs
    const MAX_CHARS = 24000;
    let processedDiff = diff;
    if (diffChars > MAX_CHARS) {
        updateProgress('analyzing', `Large diff detected (${diffChars} chars). Truncating to ${MAX_CHARS} for speed...`);
        processedDiff = diff.slice(0, MAX_CHARS) + "\n... (Diff truncated for performance)";
    }

    // Chunking Logic
    const CHUNK_SIZE = 6000;
    const chunks = [];
    for (let i = 0; i < processedDiff.length; i += CHUNK_SIZE) {
        chunks.push(processedDiff.slice(i, i + CHUNK_SIZE));
    }

    // System / Setup Prompt
    const initialPrompt = `
You are an expert developer.
I will act as a system that feeds you a git diff in multiple parts.
Your task is to simply read each part and reply with "OK".
Do NOT generate the commit message yet.
Wait for the final instruction.
`;

    updateProgress('analyzing', `Initializing Session...`);

    // 1. Send Instruction
    await session.prompt(initialPrompt, {
        temperature: 0.1,
        maxTokens: 5
    });

    // 2. Send Chunks
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const progressMsg = `Reading Part ${i + 1}/${chunks.length} (${Math.round(((i + 1) / chunks.length) * 100)}%)...`;
        updateProgress('analyzing', progressMsg);

        await session.prompt(`Part ${i + 1}:\n${chunk}`, {
            temperature: 0.1,
            maxTokens: 5 // Expecting "OK"
        });
    }

    // 3. Final Generation
    const finalPrompt = `
STOP. All chunks received.
Task: Analyze the full diff provided above and generate a SINGLE "Conventional Commit" message.
Output MUST be valid JSON.

Rules:
1. Format: <type>(<scope>): <description>
2. Types: feat, fix, docs, style, refactor, test, chore.
   - feat: new feature
   - fix: bug fix
   - chore: maintenance/dependencies
3. Keep the first line under 50 characters.
4. Be concise.

Example:
{
  "commit_message": "feat(auth): add login validation"
}

Your JSON Response:
`;

    updateProgress('generating', `Drafting message...`);

    // Strict Grammar Enforcement
    const grammar = new LlamaJsonSchemaGrammar(llama, {
        type: "object",
        properties: {
            commit_message: {
                type: "string"
            }
        }
    });

    let generatedTokens = 0;
    const response = await session.prompt(finalPrompt, {
        grammar: grammar, // <--- Key Fix
        temperature: 0.2,
        maxTokens: 200,
        onToken: (chunk) => {
            generatedTokens += chunk.length;
            updateProgress('generating', `Drafting message... (${generatedTokens} tokens)`);
        }
    });

    const cleanedResponse = response.trim();
    try {
        const parsed = JSON.parse(cleanedResponse);
        return parsed.commit_message || cleanedResponse;
    } catch (e) {
        console.warn("Failed to parse grammar-enforced JSON", e);
    }

    return cleanedResponse;
}
