import simpleGit from 'simple-git';

const git = simpleGit();

export async function getStagedDiff() {
    // Check if inside a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
        throw new Error('Not a git repository');
    }

    // Exclude lockfiles from the diff sent to AI to prevent token explosion/slowness
    const diff = await git.diff([
        '--cached',
        ':(exclude)package-lock.json',
        ':(exclude)yarn.lock',
        ':(exclude)pnpm-lock.yaml'
    ]);
    return diff;
}

export async function commitChanges(message) {
    await git.commit(message);
}
