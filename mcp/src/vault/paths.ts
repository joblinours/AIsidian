import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export class PathError extends Error {}

/**
 * Normalizes a vault-relative path supplied by a client.
 * - forward slashes, NFC, no leading/trailing slash
 * - rejects absolute paths, `..`, empty or hidden components (.git, .obsidian, .trash...)
 */
export function normalizeRelPath(input: string, opts: { allowRoot?: boolean } = {}): string {
  if (typeof input !== 'string') throw new PathError('Chemin invalide');
  let p = input.normalize('NFC').replace(/\\/g, '/').trim();
  if (p.includes('\0')) throw new PathError('Chemin invalide');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) throw new PathError('Chemin absolu interdit');
  p = p.replace(/^\.\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
  if (p === '' || p === '.') {
    if (opts.allowRoot) return '';
    throw new PathError('Chemin vide');
  }
  for (const part of p.split('/')) {
    if (part === '' || part === '.' || part === '..') throw new PathError('Composant de chemin interdit');
    if (part.startsWith('.')) throw new PathError('Dossiers et fichiers cachés interdits');
  }
  return p;
}

/**
 * Resolves a normalized relative path to an absolute path on disk, walking each
 * component: symbolic links are never followed, and names are matched with NFC
 * normalization (macOS/iOS may produce NFD names).
 * Returns null if a component does not exist.
 */
export async function resolveExisting(root: string, rel: string): Promise<string | null> {
  if (rel === '') return root;
  let cur = root;
  for (const part of rel.split('/')) {
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      return null;
    }
    const match =
      entries.find((e) => e.name === part) ?? entries.find((e) => e.name.normalize('NFC') === part);
    if (!match) return null;
    if (match.isSymbolicLink()) throw new PathError('Lien symbolique refusé');
    cur = join(cur, match.name);
  }
  const st = await lstat(cur);
  if (st.isSymbolicLink()) throw new PathError('Lien symbolique refusé');
  return cur;
}

/**
 * Resolves a path for creation: the parent directories that exist are resolved
 * like resolveExisting; missing ones are appended as-is (NFC).
 */
export async function resolveForWrite(root: string, rel: string): Promise<string> {
  const parts = rel.split('/');
  let cur = root;
  let i = 0;
  for (; i < parts.length; i++) {
    const part = parts[i]!;
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      break;
    }
    const match =
      entries.find((e) => e.name === part) ?? entries.find((e) => e.name.normalize('NFC') === part);
    if (!match) break;
    if (match.isSymbolicLink()) throw new PathError('Lien symbolique refusé');
    cur = join(cur, match.name);
  }
  for (; i < parts.length; i++) cur = join(cur, parts[i]!);
  return cur;
}

/** Characters forbidden in file names on at least one supported platform, plus Obsidian link syntax. */
const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;

/** Turns a human title into a safe file base name (without extension). */
export function titleToFileName(title: string): string {
  const name = title
    .normalize('NFC')
    .replace(FORBIDDEN, ' ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 150)
    .trim();
  if (!name) throw new PathError('Titre vide après nettoyage');
  return name;
}
