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

    updateProgress('analyzing', `Analyzing Diff (${diffLines} lines, ${processedDiff.length} chars)...`);

    // Extract file names from diff for better context
    const fileNames = [...processedDiff.matchAll(/^[\+\-\s]*diff --git a\/(.+?) b\/(.+?)$/gm)]
        .map(match => match[1] || match[2])
        .filter((name, index, arr) => arr.indexOf(name) === index); // unique files

    const fileTypes = fileNames.map(name => {
        const ext = name.split('.').pop()?.toLowerCase();
        return ext ? `${ext} files` : 'files';
    }).filter((type, index, arr) => arr.indexOf(type) === index);

    const prompt = `
You are an expert developer creating conventional commit messages.
Task: Analyze the provided git diff and generate a SINGLE "Conventional Commit" message.
Output MUST be valid JSON.

Rules:
1. Format: <type>(<scope>): <description>
2. Types: feat, fix, docs, style, refactor, test, chore.
   - feat: new feature for users
   - fix: bug fix
   - docs: documentation changes
   - style: formatting, semicolons, line endings, indentation (no logic changes)
   - refactor: code restructuring without changing functionality
   - test: adding/modifying tests
   - chore: maintenance, dependencies, tooling
3. Scope: affected component (api, ui, config, scripts) or file type (sh, py, js)
4. Keep the first line under 50 characters.
5. Be specific and accurate to the actual changes.

Analyze the diff carefully:
- Look at file names and extensions to understand context
- Identify what actually changed (content vs formatting)
- For shell scripts (.sh): line ending fixes are 'style' type
- For test files: changes to test logic are 'test', not 'fix(test)'

Diff:
${processedDiff}

Examples:
- Line ending fixes in shell scripts: "style(sh): fix line endings"
- Adding tests: "test: add validation for user input"
- Bug fix in API: "fix(api): handle null response"
- Documentation update: "docs: update installation guide"
- Dependency update: "chore: update lodash to v4.17.21"

Your JSON Response:
`;

    // Strict Grammar Enforcement
    const grammar = new LlamaJsonSchemaGrammar(llama, {
        type: "object",
        properties: {
            commit_message: {
                type: "string"
            }
        }
    });

    updateProgress('generating', `Drafting message...`);

    let generatedTokens = 0;
    const response = await session.prompt(prompt, {
        grammar: grammar,
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
