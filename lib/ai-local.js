import { fileURLToPath } from 'url';
import path from 'path';
import { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar } from "node-llama-cpp";
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper function to analyze diff content
function analyzeDiffContent(diff) {
    const lines = diff.split('\n');
    const analysis = {
        additions: [],
        deletions: [],
        fileChanges: []
    };

    let currentFile = null;

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
            if (match) {
                currentFile = match[1];
                analysis.fileChanges.push(currentFile);
            }
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            analysis.additions.push(line.substring(1).trim());
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            analysis.deletions.push(line.substring(1).trim());
        }
    }

    return analysis;
}

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

    // Categorize files by type and priority
    const fileCategories = {
        gitignore: fileNames.filter(name => name === '.gitignore'),
        shell: fileNames.filter(name => name.endsWith('.sh')),
        docker: fileNames.filter(name => name.toLowerCase().includes('dockerfile') || name.endsWith('.dockerfile')),
        config: fileNames.filter(name => ['yml', 'yaml', 'json', 'config', 'conf', 'ini'].some(ext => name.endsWith(`.${ext}`))),
        scripts: fileNames.filter(name => ['py', 'js', 'ts', 'bash', 'zsh'].some(ext => name.endsWith(`.${ext}`))),
        docs: fileNames.filter(name => ['md', 'txt', 'rst', 'adoc'].some(ext => name.endsWith(`.${ext}`))),
        other: fileNames.filter(name => !['sh', 'py', 'js', 'ts', 'yml', 'yaml', 'json', 'md', 'txt', 'dockerfile', '.gitignore'].some(ext =>
            name.endsWith(`.${ext}`) || name.toLowerCase().includes('dockerfile') || name === '.gitignore'))
    };

    // Determine primary file type for scope
    let primaryScope = 'misc';
    if (fileCategories.gitignore.length > 0) primaryScope = 'git';
    else if (fileCategories.shell.length > 0) primaryScope = 'sh';
    else if (fileCategories.scripts.length > 0) primaryScope = fileCategories.scripts[0].split('.').pop() || 'script';
    else if (fileCategories.config.length > 0) primaryScope = 'config';
    else if (fileCategories.docs.length > 0) primaryScope = 'docs';
    else if (fileCategories.docker.length > 0) primaryScope = 'docker';

    // Analyze diff content for better context
    const diffAnalysis = analyzeDiffContent(processedDiff);

    const prompt = `
You are an expert developer creating conventional commit messages.
CRITICAL: Analyze the ACTUAL CONTENT of the diff changes, not just file names.

Task: Carefully examine the git diff lines and generate a SINGLE "Conventional Commit" message.
Output MUST be valid JSON.

CONTENT ANALYSIS INSTRUCTIONS:
1. Look at the lines starting with + (additions) and - (deletions)
2. Identify what actually changed in the code/content
3. Don't make assumptions - base your message on what's shown in the diff
4. For .gitignore: additions are patterns to ignore files/folders
5. For Dockerfiles: RUN commands, COPY commands, ENV variables, etc.
6. For scripts: actual code changes, permissions, line endings

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
3. Scope: Use file extension as scope - docker for Dockerfiles, sh for shell scripts
4. Keep the first line under 50 characters.
5. Be specific and accurate to the actual changes shown in the diff.

PRIMARY FILE TYPE: ${primaryScope}

Diff:
${processedDiff}

Examples based on actual diff content:
- Adding pattern to .gitignore: "chore(git): ignore settings.json"
- Combining RUN commands in Dockerfile: "refactor(docker): combine multiple RUN commands"
- Adding ENV variables in Dockerfile: "feat(docker): add environment variables"
- Changing script permissions: "fix(sh): update script permissions"
- Line ending changes: "style(sh): fix line endings"
- Combining multiple commands: "refactor(docker): merge RUN instructions"

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
