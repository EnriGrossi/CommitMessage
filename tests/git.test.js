import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStagedDiff, commitChanges } from '../lib/git.js';

// Mock simple-git
const { mGit } = vi.hoisted(() => {
    return {
        mGit: {
            diff: vi.fn(),
            commit: vi.fn(),
            checkIsRepo: vi.fn().mockResolvedValue(true),
        }
    };
});

vi.mock('simple-git', () => {
    return {
        default: () => mGit // Correct factory for default export
    };
});

describe('Git Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('getStagedDiff should call git diff with --cached', async () => {
        mGit.diff.mockResolvedValue('mock diff content');

        const diff = await getStagedDiff();

        expect(mGit.diff).toHaveBeenCalledWith(['--cached']);
        expect(diff).toBe('mock diff content');
    });

    it('commitChanges should call git commit with message', async () => {
        mGit.commit.mockResolvedValue('mock commit result');

        await commitChanges('feat: test commit');

        expect(mGit.commit).toHaveBeenCalledWith('feat: test commit');
    });
});
