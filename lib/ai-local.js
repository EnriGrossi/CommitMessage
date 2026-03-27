import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getLlama, LlamaChatSession, LlamaJsonSchemaGrammar, LlamaLogLevel } from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Known harmless warnings from llama.cpp that we suppress
const SUPPRESSED_WARNINGS = [
    'control-looking token',
    'was not control-type'
];

// Cached model instance to avoid reloading for refinement
let _cachedLlama = null;
let _cachedModel = null;
let _cachedModelPath = null;

async function getOrLoadModel(modelPath, updateProgress) {
    if (_cachedLlama && _cachedModel && _cachedModelPath === modelPath) {
        updateProgress('loading', 'Reusing loaded AI Model...');
        return { llama: _cachedLlama, model: _cachedModel };
    }

    updateProgress('loading', 'Loading AI Model...');
    const llama = await getLlama({
        logLevel: LlamaLogLevel.warn,
        logger: (level, message) => {
            // Suppress known harmless warnings from llama.cpp
            if (SUPPRESSED_WARNINGS.some(w => message.includes(w))) return;
            // Let everything else through
            if (level === LlamaLogLevel.error) {
                console.error(`[llama.cpp] ${message}`);
            } else if (level === LlamaLogLevel.warn) {
                console.warn(`[llama.cpp] ${message}`);
            }
        }
    });
    const model = await llama.loadModel({ modelPath });

    _cachedLlama = llama;
    _cachedModel = model;
    _cachedModelPath = modelPath;

    return { llama, model };
}

// Analyze diff content to build a structured summary for the prompt
function analyzeDiffContent(diff) {
    const lines = diff.split('\n');
    const analysis = {
        additions: 0,
        deletions: 0,
        files: [],
        summary: [],
        // Key content lines extracted per file (most meaningful changes)
        keyChanges: []
    };

    let currentFile = null;
    let fileAdditions = 0;
    let fileDeletions = 0;
    let fileAddedLines = [];
    let fileDeletedLines = [];

    const flushFile = () => {
        if (currentFile) {
            analysis.files.push({
                name: currentFile,
                added: fileAdditions,
                deleted: fileDeletions
            });

            // Extract the most meaningful added/deleted lines for this file
            const meaningful = extractMeaningfulLines(fileAddedLines, fileDeletedLines);
            if (meaningful.length > 0) {
                analysis.keyChanges.push({ file: currentFile, changes: meaningful });
            }

            fileAdditions = 0;
            fileDeletions = 0;
            fileAddedLines = [];
            fileDeletedLines = [];
        }
    };

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            flushFile();
            const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
            if (match) {
                currentFile = match[2];
            }
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            analysis.additions++;
            fileAdditions++;
            fileAddedLines.push(line.substring(1).trim());
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            analysis.deletions++;
            fileDeletions++;
            fileDeletedLines.push(line.substring(1).trim());
        }
    }
    flushFile();

    // Build a concise summary string
    for (const f of analysis.files) {
        const parts = [];
        if (f.added > 0) parts.push(`+${f.added}`);
        if (f.deleted > 0) parts.push(`-${f.deleted}`);
        analysis.summary.push(`${f.name} (${parts.join(', ')})`);
    }

    return analysis;
}

// Extract the most meaningful lines from a file's changes, filtering noise
function extractMeaningfulLines(addedLines, deletedLines) {
    const isNoise = (line) => {
        const trimmed = line.trim();
        return (
            trimmed === '' ||
            trimmed === '{' || trimmed === '}' ||
            trimmed === '(' || trimmed === ')' ||
            trimmed === ');' || trimmed === '};' ||
            trimmed === ']' || trimmed === '[' ||
            /^\/[/*]/.test(trimmed) ||  // comments
            /^\*/.test(trimmed) ||       // block comment continuation
            /^import\s/.test(trimmed) || // import statements (less meaningful)
            /^require\(/.test(trimmed)
        );
    };

    const meaningful = [];

    for (const line of addedLines) {
        if (!isNoise(line) && line.length > 3) {
            meaningful.push(`+ ${line}`);
        }
    }
    for (const line of deletedLines) {
        if (!isNoise(line) && line.length > 3) {
            meaningful.push(`- ${line}`);
        }
    }

    // Cap at 10 most meaningful lines per file to keep prompt small
    return meaningful.slice(0, 10);
}

// Build a human-readable digest of the diff for the prompt
function buildDiffDigest(analysis) {
    const parts = [];

    for (const fc of analysis.keyChanges) {
        parts.push(`File: ${fc.file}`);
        for (const change of fc.changes) {
            parts.push(`  ${change}`);
        }
    }

    return parts.join('\n');
}

// Determine the conventional commit type from the diff analysis
function inferCommitType(analysis, fileNames) {
    const hasTests = fileNames.some(f => f.includes('test') || f.includes('spec'));
    const hasDocs = fileNames.some(f => /\.(md|txt|rst|adoc)$/i.test(f));
    const hasOnlyDocs = hasDocs && fileNames.every(f => /\.(md|txt|rst|adoc)$/i.test(f));
    const hasOnlyTests = hasTests && fileNames.every(f => f.includes('test') || f.includes('spec'));

    if (hasOnlyTests) return 'test';
    if (hasOnlyDocs) return 'docs';

    // Check if it's mostly config/chore files
    const configFiles = fileNames.filter(f =>
        /\.(json|yml|yaml|toml|ini|conf|config)$/i.test(f) ||
        f.includes('Dockerfile') || f === '.gitignore'
    );
    if (configFiles.length === fileNames.length) return 'chore';

    // Default: if there are deletions and additions it could be refactor, but we let the model decide
    return null;
}

// Determine scope from file names
function inferScope(fileNames) {
    if (fileNames.length === 0) return null;

    // Single file: use the directory or filename as scope
    if (fileNames.length === 1) {
        const parts = fileNames[0].split('/');
        if (parts.length > 1) return parts[parts.length - 2]; // parent directory
        return parts[0].replace(/\.[^.]+$/, ''); // filename without extension
    }

    // Multiple files: find common directory
    const dirs = fileNames.map(f => {
        const parts = f.split('/');
        return parts.length > 1 ? parts[parts.length - 2] : '';
    }).filter(Boolean);

    const uniqueDirs = [...new Set(dirs)];
    if (uniqueDirs.length === 1) return uniqueDirs[0];

    // Check if all files share a common root
    const roots = fileNames.map(f => f.split('/')[0]);
    const uniqueRoots = [...new Set(roots)];
    if (uniqueRoots.length === 1) return uniqueRoots[0];

    return null;
}

function makeElapsedFn(startTime) {
    return () => {
        const seconds = Math.floor((Date.now() - startTime) / 1000);
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };
}

// Validate that a message follows conventional commits format
const CONVENTIONAL_COMMIT_RE = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([a-z0-9._-]+\))?:\s.+/i;

function sanitizeCommitMessage(message) {
    if (!message || typeof message !== 'string') return null;

    // Remove surrounding quotes if present
    let cleaned = message.trim().replace(/^["']|["']$/g, '').trim();

    // If it already matches, return as-is
    if (CONVENTIONAL_COMMIT_RE.test(cleaned)) {
        return cleaned.split('\n')[0]; // Only first line
    }

    // Try to extract a conventional commit from a longer string
    const match = cleaned.match(CONVENTIONAL_COMMIT_RE);
    if (match) {
        return cleaned.substring(match.index).split('\n')[0];
    }

    return null;
}

export async function generateCommitMessage(modelPath, diff, onProgress) {
    const startTime = Date.now();
    const getElapsed = makeElapsedFn(startTime);
    const timing = {};
    let lastStageStart = startTime;
    let lastStage = null;

    const updateProgress = (stage, message) => {
        const now = Date.now();
        if (lastStage && lastStage !== stage) {
            timing[lastStage] = (timing[lastStage] || 0) + (now - lastStageStart);
            lastStageStart = now;
        }
        lastStage = stage;
        if (onProgress) onProgress(stage, `${message} [${getElapsed()}]`);
    };

    const { llama, model } = await getOrLoadModel(modelPath, updateProgress);

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

    // Extract file names from diff
    const fileNames = [...processedDiff.matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)]
        .map(match => match[2])
        .filter((name, index, arr) => arr.indexOf(name) === index);

    // Analyze diff content for structured context
    const analysis = analyzeDiffContent(processedDiff);
    const inferredType = inferCommitType(analysis, fileNames);
    const inferredScope = inferScope(fileNames);
    const diffDigest = buildDiffDigest(analysis);

    // Build hints for the model
    const hints = [];
    if (inferredType) hints.push(`Suggested type: ${inferredType}`);
    if (inferredScope) hints.push(`Suggested scope: ${inferredScope}`);
    hints.push(`Files changed: ${analysis.summary.join(', ')}`);
    hints.push(`Total: +${analysis.additions} additions, -${analysis.deletions} deletions`);

    // For small diffs, include the raw diff. For larger ones, use the digest.
    const diffForPrompt = processedDiff.length <= 4000 ? processedDiff : diffDigest;

    const prompt = `You are a commit message generator. Output ONLY valid JSON.

Analyze the changes below and generate a conventional commit message.

FORMAT: <type>(<scope>): <short description>
TYPES: feat, fix, docs, style, refactor, test, chore
RULES:
- First line MUST be under 50 characters
- Description must be lowercase, no period at end
- Describe WHAT changed in the code, not generic descriptions
- The description must mention specific functions, variables, or features that were added/changed/removed

EXAMPLES:
- feat(auth): add jwt token refresh logic
- fix(api): handle null response in user endpoint
- docs(readme): add installation instructions
- test(utils): add unit tests for date parser
- chore(deps): update axios to v1.6.7
- refactor(config): extract db settings to env

CONTEXT:
${hints.join('\n')}

KEY CHANGES:
${diffDigest || '(no meaningful code changes detected)'}

DIFF:
${diffForPrompt}

Your JSON response:`;

    const grammar = new LlamaJsonSchemaGrammar(llama, {
        type: "object",
        properties: {
            commit_message: {
                type: "string"
            }
        }
    });

    updateProgress('generating', 'Drafting message...');

    let generatedTokens = 0;
    const response = await session.prompt(prompt, {
        grammar,
        temperature: 0.6,
        maxTokens: 100,
        onToken: (chunk) => {
            generatedTokens += chunk.length;
            updateProgress('generating', `Drafting message... (${generatedTokens} tokens)`);
        }
    });

    // Finalize timing for the last stage
    if (lastStage) {
        timing[lastStage] = (timing[lastStage] || 0) + (Date.now() - lastStageStart);
    }
    timing.total = Date.now() - startTime;
    timing.tokens = generatedTokens;

    const cleanedResponse = response.trim();
    try {
        const parsed = JSON.parse(cleanedResponse);
        const raw = parsed.commit_message || cleanedResponse;
        const sanitized = sanitizeCommitMessage(raw);
        if (sanitized) return { message: sanitized, timing };
        const fallbackType = inferredType || 'chore';
        const fallbackScope = inferredScope ? `(${inferredScope})` : '';
        return { message: `${fallbackType}${fallbackScope}: update ${fileNames[0] || 'files'}`, timing };
    } catch (e) {
        console.warn("Failed to parse grammar-enforced JSON", e);
    }

    const sanitized = sanitizeCommitMessage(cleanedResponse);
    if (sanitized) return { message: sanitized, timing };

    const fallbackType = inferredType || 'chore';
    const fallbackScope = inferredScope ? `(${inferredScope})` : '';
    return { message: `${fallbackType}${fallbackScope}: update ${fileNames[0] || 'files'}`, timing };
}

export async function refineCommitMessage(modelPath, originalMessage, userFeedback, diff, onProgress) {
    const startTime = Date.now();
    const getElapsed = makeElapsedFn(startTime);
    const timing = {};
    let lastStageStart = startTime;
    let lastStage = null;

    const updateProgress = (stage, message) => {
        const now = Date.now();
        if (lastStage && lastStage !== stage) {
            timing[lastStage] = (timing[lastStage] || 0) + (now - lastStageStart);
            lastStageStart = now;
        }
        lastStage = stage;
        if (onProgress) onProgress(stage, `${message} [${getElapsed()}]`);
    };

    const { llama, model } = await getOrLoadModel(modelPath, updateProgress);

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

    // Build a digest for the refiner too
    const analysis = analyzeDiffContent(processedDiff);
    const diffDigest = buildDiffDigest(analysis);

    const prompt = `You are a commit message refiner. Output ONLY valid JSON.

Take the original commit message and the user's feedback, then generate an improved version.

FORMAT: <type>(<scope>): <short description>
TYPES: feat, fix, docs, style, refactor, test, chore
RULES:
- First line MUST be under 50 characters
- Description must be lowercase, no period at end
- Address the user's feedback as the PRIMARY concern
- Describe WHAT changed specifically, not generic descriptions

Original message: "${originalMessage}"
User feedback: "${userFeedback}"

KEY CHANGES:
${diffDigest || '(no meaningful code changes detected)'}

Diff (for reference):
${processedDiff.length <= 4000 ? processedDiff : diffDigest}

Your JSON response:`;

    const grammar = new LlamaJsonSchemaGrammar(llama, {
        type: "object",
        properties: {
            refined_message: {
                type: "string"
            }
        }
    });

    updateProgress('refining', 'Refining message based on feedback...');

    let generatedTokens = 0;
    const response = await session.prompt(prompt, {
        grammar,
        temperature: 0.5,
        maxTokens: 100,
        onToken: (chunk) => {
            generatedTokens += chunk.length;
            updateProgress('refining', `Refining message... (${generatedTokens} tokens)`);
        }
    });

    // Finalize timing
    if (lastStage) {
        timing[lastStage] = (timing[lastStage] || 0) + (Date.now() - lastStageStart);
    }
    timing.total = Date.now() - startTime;
    timing.tokens = generatedTokens;

    const cleanedResponse = response.trim();
    try {
        const parsed = JSON.parse(cleanedResponse);
        const raw = parsed.refined_message || cleanedResponse;
        const sanitized = sanitizeCommitMessage(raw);
        if (sanitized) return { message: sanitized, timing };
        return { message: originalMessage, timing };
    } catch (e) {
        console.warn("Failed to parse grammar-enforced JSON", e);
    }

    const sanitized = sanitizeCommitMessage(cleanedResponse);
    return { message: sanitized || originalMessage, timing };
}
