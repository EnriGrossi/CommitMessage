import simpleGit from 'simple-git';

const git = simpleGit();

export async function getStagedDiff() {
    // Check if inside a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
        throw new Error('Not a git repository');
    }

    const diff = await git.diff(['--cached']);
    return diff;
}

export async function commitChanges(message) {
    await git.commit(message);
}
