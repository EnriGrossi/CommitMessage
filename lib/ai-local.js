import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar } from "node-llama-cpp";

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
    const fileNames = [...processedDiff.matchAll(/^[+-\s]*diff --git a\/(.+?) b\/(.+?)$/gm)]
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
    const categoryCounts = {
        git: fileCategories.gitignore.length,
        sh: fileCategories.shell.length,
        script: fileCategories.scripts.length,
        config: fileCategories.config.length,
        docs: fileCategories.docs.length,
        docker: fileCategories.docker.length,
        other: fileCategories.other.length
    };

    const maxCount = Math.max(...Object.values(categoryCounts));
    const primaryCategories = Object.keys(categoryCounts).filter(key => categoryCounts[key] === maxCount);

    let primaryScope = 'misc';
    if (primaryCategories.length === 1) {
        primaryScope = primaryCategories[0];
        if (primaryScope === 'script') {
            primaryScope = fileCategories.scripts[0]?.split('.').pop() || 'script';
        }
    } // If multiple categories have same count, keep 'misc'



    // Analyze diff content for better context
    analyzeDiffContent(processedDiff);

    // Add randomness to ensure different generations
    const randomSeed = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    const uniqueId = `${randomSeed}-${timestamp}-${Math.random().toString(36)}`;

    const prompt = `
You are an expert developer creating conventional commit messages.
CRITICAL: Analyze the ACTUAL CONTENT of the diff changes, not just file names.

Task: Carefully examine the git diff lines and generate a SINGLE "Conventional Commit" message.
Output MUST be valid JSON.

Generation ID: ${uniqueId}

CONTENT ANALYSIS INSTRUCTIONS:
1. Look ONLY at the lines starting with + (additions) and - (deletions) in the diff below
2. Identify what actually changed in the code/content - be precise
3. DO NOT make assumptions or use generic examples - base your message ONLY on what's shown in the diff
4. Analyze the file types and changes: ignore files, code changes, test additions, etc.
5. The commit message must reflect the actual modifications in the diff

Rules:
1. Format: <type>(<scope>): <description>
2. Types: feat, fix, docs, style, refactor, test, chore
   - feat: new feature for users
   - fix: bug fix
   - docs: documentation changes
   - style: formatting, semicolons, line endings, indentation (no logic changes)
   - refactor: code restructuring without changing functionality
   - test: adding/modifying tests
   - chore: maintenance, dependencies, tooling
3. Scope: Use appropriate scope based on files changed (e.g., js, test, git, config)
4. Keep the first line under 50 characters
5. Be specific and accurate to the actual changes shown in the diff - do not invent changes

Diff Content:
${processedDiff}

Generate a commit message that accurately describes the changes in this specific diff.

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
        temperature: 1,
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

export async function refineCommitMessage(modelPath, originalMessage, userFeedback, diff, onProgress) {
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

    updateProgress('loading', 'Loading AI Model for refinement...');
    const llama = await getLlama();
    const model = await llama.loadModel({
        modelPath: modelPath
    });

    updateProgress('context', 'Creating Context Window...');
    const context = await model.createContext();
    const session = new LlamaChatSession({
        contextSequence: context.getSequence()
    });

    // Truncate diff if too large for refinement
    const MAX_CHARS = 12000;
    let processedDiff = diff;
    if (diff.length > MAX_CHARS) {
        processedDiff = diff.slice(0, MAX_CHARS) + "\n... (Diff truncated for performance)";
    }

    const randomSeed = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    const uniqueId = `${randomSeed}-${timestamp}-${Math.random().toString(36)}`;

    const prompt = `
You are an expert developer refining conventional commit messages based on user feedback.

Task: Take the original commit message and user's feedback about what's wrong with it, then generate an improved version.
Output MUST be valid JSON.

Generation ID: ${uniqueId}

RESPONSE GUIDELINES:
1. PRIORITY: The user's feedback is the PRIMARY directive - address their specific concerns first
2. The feedback may request changes to focus, scope, type, or content that differ from the original message
3. Use the diff content as REFERENCE to ensure the refined message is technically accurate
4. If the feedback requests a different focus (e.g., different file or feature), shift the message accordingly
5. Maintain conventional commit format: <type>(<scope>): <description>
6. Keep the first line under 50 characters
7. Make the message more specific, accurate, or appropriate based on the feedback
8. If the feedback suggests a different type/scope, implement that change

Original Commit Message: "${originalMessage}"

User Feedback: "${userFeedback}"

Diff Context (for reference - use to validate technical accuracy):
${processedDiff}

Generate a refined commit message that directly addresses the user's feedback as the primary requirement.

Your JSON Response:
`;

    // Strict Grammar Enforcement
    const grammar = new LlamaJsonSchemaGrammar(llama, {
        type: "object",
        properties: {
            refined_message: {
                type: "string"
            }
        }
    });

    updateProgress('refining', `Refining message based on feedback...`);

    let generatedTokens = 0;
    const response = await session.prompt(prompt, {
        grammar: grammar,
        temperature: 0.8, // Slightly lower temperature for refinement
        maxTokens: 200,
        onToken: (chunk) => {
            generatedTokens += chunk.length;
            updateProgress('refining', `Refining message... (${generatedTokens} tokens)`);
        }
    });

    const cleanedResponse = response.trim();
    try {
        const parsed = JSON.parse(cleanedResponse);
        return parsed.refined_message || cleanedResponse;
    } catch (e) {
        console.warn("Failed to parse grammar-enforced JSON", e);
    }

    return cleanedResponse;
}
