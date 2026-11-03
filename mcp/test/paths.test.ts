import { describe, expect, it } from 'vitest';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeRelPath, PathError, resolveExisting, titleToFileName } from '../src/vault/paths.js';
import { Permissions } from '../src/vault/permissions.js';
import { setup, seed } from './helpers.js';

describe('paths', () => {
  it('rejects traversal, absolute and hidden paths', () => {
    for (const p of ['../etc/passwd', '/etc/passwd', 'a/../../b', '.git/config', 'x/.obsidian/y', 'C:/x', 'a\0b']) {
      expect(() => normalizeRelPath(p), p).toThrow(PathError);
    }
    expect(normalizeRelPath('./00-Inbox//note.md')).toBe('00-Inbox/note.md');
    expect(normalizeRelPath('00-Inbox\\note.md')).toBe('00-Inbox/note.md');
  });

  it('never follows symlinks', async () => {
    const { vaultDir } = await setup();
    await symlink('/etc', join(vaultDir, 'evil'));
    await expect(resolveExisting(vaultDir, 'evil/passwd')).rejects.toThrow(PathError);
  });

  it('matches NFD names on disk', async () => {
    const { vaultDir } = await setup();
    await seed(vaultDir, 'Note e\u0301te\u0301.md', 'x');
    expect(await resolveExisting(vaultDir, 'Note \u00e9t\u00e9.md')).not.toBeNull();
  });

  it('builds safe file names', () => {
    expect(titleToFileName('Docker Compose : réseaux / volumes?')).toBe('Docker Compose réseaux volumes');
    expect(() => titleToFileName('///')).toThrow();
  });
});

describe('permissions', () => {
  const p = new Permissions({
    default: 'rw',
    rules: [
      { path: '99-Système', access: 'ro' },
      { path: '20-Domaines/Pro', access: 'ro' },
    ],
  });
  it('applies read-only folders, case-insensitively', () => {
    expect(p.canWrite('20-Domaines/Pro/x.md')).toBe(false);
    expect(p.canWrite('20-domaines/pro/x.md')).toBe(false);
    expect(p.canWrite('99-Système/Agent/Règles.md')).toBe(false);
    expect(p.canWrite('20-Domaines/Projet/x.md')).toBe(true);
    expect(p.canWrite('00-Inbox/x.md')).toBe(true);
  });
});
