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
CRITICAL: Pay close attention to FILE NAMES and EXTENSIONS in the diff.

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
3. Scope: Use file extension as scope - .sh for shell scripts, .py for Python, .js for JavaScript
4. Keep the first line under 50 characters.
5. Be specific and accurate to the actual changes.

FILE ANALYSIS REQUIREMENTS:
- Check file names in diff header (diff --git a/filename b/filename)
- .sh files = shell scripts, usually 'feat', 'fix', or 'style'
- .py files = Python scripts
- .js files = JavaScript files
- New files = 'feat' type
- Formatting changes = 'style' type

Diff:
${processedDiff}

Examples by file type:
- New shell script (.sh): "feat(sh): add test script"
- Shell script modifications (.sh): "fix(sh): update script logic"
- Line ending fixes in shell scripts (.sh): "style(sh): fix line endings"
- Python test file (.py): "test(py): add validation"
- JavaScript feature (.js): "feat(js): add new functionality"
- Documentation (.md): "docs: update readme"
- Dependencies: "chore: update dependencies"

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
