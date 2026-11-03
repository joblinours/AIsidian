import { execFile } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const VAULT_GITIGNORE = `# AIsidian: local history only, never pushed.
.obsidian/workspace*.json
.obsidian/cache
.trash/
.DS_Store
`;

export interface CommitInfo {
  sha: string;
  date: string;
  subject: string;
}

/** Thin wrapper over the git CLI for the local, never-pushed vault repository. */
export class Git {
  constructor(
    private dir: string,
    private author: { name: string; email: string },
  ) {}

  private async git(args: string[], opts: { allowFail?: boolean } = {}): Promise<string> {
    try {
      const { stdout } = await exec(
        'git',
        [
          '-C', this.dir,
          '-c', `user.name=${this.author.name}`,
          '-c', `user.email=${this.author.email}`,
          '-c', 'core.quotepath=false',
          '-c', 'commit.gpgsign=false',
          '-c', `safe.directory=${this.dir}`,
          ...args,
        ],
        { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8' } },
      );
      return stdout;
    } catch (e) {
      if (opts.allowFail) return '';
      throw e;
    }
  }

  async init(): Promise<void> {
    try {
      await access(join(this.dir, '.git'));
    } catch {
      await this.git(['init', '-q', '-b', 'main']);
    }
    try {
      await access(join(this.dir, '.gitignore'));
    } catch {
      await writeFile(join(this.dir, '.gitignore'), VAULT_GITIGNORE);
    }
    if (!(await this.head())) {
      await this.commitAll('[init] Dépôt local du vault');
    }
  }

  async head(): Promise<string | null> {
    const out = await this.git(['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true });
    return out.trim() || null;
  }

  /** Commits only the given paths (relative to the vault). Returns the new SHA or null if nothing changed. */
  async commitPaths(paths: string[], message: string): Promise<string | null> {
    if (paths.length === 0) return null;
    await this.git(['add', '-A', '--', ...paths]);
    const staged = await this.git(['diff', '--cached', '--name-only', '--', ...paths]);
    if (!staged.trim()) return null;
    await this.git(['commit', '-q', '--no-verify', '-m', message, '--', ...paths]);
    return this.head();
  }

  /**
   * Commits every pending change in the vault. Returns the new SHA, or null if
   * clean (unless allowEmpty: used for agent run markers, which must always exist).
   */
  async commitAll(message: string, opts: { allowEmpty?: boolean } = {}): Promise<string | null> {
    await this.git(['add', '-A']);
    const staged = await this.git(['diff', '--cached', '--name-only']);
    if (!staged.trim() && !opts.allowEmpty && (await this.head())) return null;
    await this.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', message]);
    return this.head();
  }

  /** Files changed between a commit and HEAD (A/M/D/R with paths). */
  async changedSince(sha: string): Promise<{ status: string; path: string; from?: string }[]> {
    const out = await this.git(['diff', '--name-status', '-M', '-z', `${sha}`, 'HEAD']);
    return parseNameStatusZ(out);
  }

  /** First commit at or after a date, used to compute changes since a timestamp. */
  async lastCommitBefore(date: Date): Promise<string | null> {
    const out = await this.git(['rev-list', '-1', `--before=${date.toISOString()}`, 'HEAD'], { allowFail: true });
    return out.trim() || null;
  }

  async rootCommit(): Promise<string | null> {
    const out = await this.git(['rev-list', '--max-parents=0', 'HEAD'], { allowFail: true });
    return out.trim().split('\n')[0] || null;
  }

  async lastCommit(): Promise<CommitInfo | null> {
    const out = await this.git(['log', '-1', '--format=%H%x00%cI%x00%s'], { allowFail: true });
    if (!out.trim()) return null;
    const [sha, date, subject] = out.trim().split('\0');
    return { sha: sha ?? '', date: date ?? '', subject: subject ?? '' };
  }

  async isHealthy(): Promise<boolean> {
    return (await this.git(['rev-parse', '--git-dir'], { allowFail: true })).trim() !== '';
  }
}

export function parseNameStatusZ(out: string): { status: string; path: string; from?: string }[] {
  const parts = out.split('\0').filter((p) => p !== '');
  const res: { status: string; path: string; from?: string }[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++]!;
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = parts[i++]!;
      const to = parts[i++]!;
      res.push({ status: status[0]!, path: to, from });
    } else {
      res.push({ status: status[0]!, path: parts[i++]! });
    }
  }
  return res;
}
