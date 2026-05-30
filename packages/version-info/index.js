import { existsSync, readFileSync }  from 'node:fs';
import { join, parse } from 'node:path';
import { cwd }         from 'node:process';
import { readFile }    from 'node:fs/promises';

const findFile = (file) => {
    let dir = cwd();

    while (dir !== parse(dir).root) {
        if (existsSync(join(dir, file))) {
            return dir;
        }

        dir = join(dir, '../');
    }
}

// Resolve gitdir reference (gitdir: /path/to/actual/.git)
const resolveGitDir = (gitPath) => {
    if (!existsSync(gitPath) || !gitPath.endsWith('.git')) {
        return gitPath;
    }
    try {
        const content = readFileSync(gitPath, 'utf8');
        if (content.startsWith('gitdir: ')) {
            return content.slice(8).trim();
        }
    } catch {
        // Ignore errors
    }
    return gitPath;
}

const gitRoot = resolveGitDir(findFile('.git'));
const pack = findFile('package.json');

const readGit = async (filename) => {
    if (!gitRoot) {
        // Return null for Vercel or other CI environments
        return null;
    }

    try {
        return await readFile(join(gitRoot, filename), 'utf8');
    } catch {
        return null;
    }
}

export const getCommit = async () => {
    const content = await readGit('.git/logs/HEAD');
    if (!content) {
        return process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
    }
    return content
        ?.split('\n')
        ?.filter(String)
        ?.pop()
        ?.split(' ')[1] || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
}

export const getBranch = async () => {
    if (process.env.CF_PAGES_BRANCH) {
        return process.env.CF_PAGES_BRANCH;
    }

    if (process.env.WORKERS_CI_BRANCH) {
        return process.env.WORKERS_CI_BRANCH;
    }

    if (process.env.VERCEL_GIT_COMMIT_REF) {
        return process.env.VERCEL_GIT_COMMIT_REF;
    }

    const content = await readGit('.git/HEAD');
    if (!content) {
        return 'main';
    }
    return content
        ?.replace(/^ref: refs\/heads\//, '')
        ?.trim() || 'main';
}

export const getRemote = async () => {
    // Vercel provides git info via environment variables
    if (process.env.VERCEL_GIT_REPO_SLUG && process.env.VERCEL_GIT_REPO_OWNER) {
        return `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`;
    }
    
    try {
        const content = await readGit('.git/config');
        if (!content) {
            throw 'could not read git config';
        }

        let remote = content
            ?.split('\n')
            ?.find(line => line.includes('url = '))
            ?.split('url = ')[1];

        if (remote?.startsWith('git@')) {
            remote = remote.split(':')[1];
        } else if (remote?.startsWith('http')) {
            remote = new URL(remote).pathname.substring(1);
        }

        remote = remote?.replace(/\.git$/, '');

        if (!remote) {
            throw 'could not parse remote';
        }

        return remote;
    } catch {
        // Fallback to derived from git info
        return 'jssyxd/cobalt';
    }
}

export const getVersion = async () => {
    if (!pack) {
        return '0.0.0';
    }

    try {
        const { version } = JSON.parse(
            await readFile(join(pack, 'package.json'), 'utf8')
        );
        return version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}
