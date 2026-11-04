import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { atomicWrite, fold, sha256 } from '../util.js';
import { inlineTags, parseNote, serializeNote, tagsOf, wikiLinks, type Frontmatter } from './frontmatter.js';
import { normalizeRelPath, PathError, resolveExisting, resolveForWrite } from './paths.js';
import { shingles, textOverlap, titleSimilarity } from './similarity.js';

export interface NoteEntry {
  path: string; // vault-relative, NFC
  title: string;
  basename: string;
  frontmatter: Frontmatter;
  tags: string[];
  links: string[];
  body: string;
  size: number;
  mtimeMs: number;
  version: string;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  tags: string[];
  snippet: string;
}

export class NotFoundError extends Error {}

/** Version identifier of a note's exact content, used for optimistic concurrency. */
export function versionOf(text: string): string {
  return sha256(text).slice(0, 16);
}

/**
 * File-system view of the vault with an mtime-based in-memory index.
 * The index is refreshed lazily on each query, so changes made by LiveSync
 * on other devices are picked up without a watcher.
 */
export class Vault {
  private cache = new Map<string, NoteEntry>();
  private shingleCache = new Map<string, { version: string; set: Set<string> }>();
  private lastScan = 0;
  private scanning: Promise<void> | null = null;

  constructor(public readonly root: string, private scanTtlMs = 2000) {}

  async ensureFolder(rel: string): Promise<void> {
    const r = normalizeRelPath(rel);
    await mkdir(await resolveForWrite(this.root, r), { recursive: true });
  }

  private async walk(dirAbs: string, dirRel: string, out: { rel: string; abs: string }[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isSymbolicLink()) continue;
      const rel = dirRel ? `${dirRel}/${e.name.normalize('NFC')}` : e.name.normalize('NFC');
      const abs = join(dirAbs, e.name);
      if (e.isDirectory()) await this.walk(abs, rel, out);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push({ rel, abs });
    }
  }

  /** Refreshes the index (at most every scanTtlMs unless forced). */
  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.lastScan < this.scanTtlMs) return;
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      const files: { rel: string; abs: string }[] = [];
      await this.walk(this.root, '', files);
      const seen = new Set<string>();
      for (const f of files) {
        seen.add(f.rel);
        const st = await stat(f.abs).catch(() => null);
        if (!st) continue;
        const cached = this.cache.get(f.rel);
        if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) continue;
        const text = await readFile(f.abs, 'utf8').catch(() => null);
        if (text === null) continue;
        this.cache.set(f.rel, this.buildEntry(f.rel, text, st.size, st.mtimeMs));
      }
      for (const k of [...this.cache.keys()]) if (!seen.has(k)) this.cache.delete(k);
      this.lastScan = Date.now();
    })().finally(() => (this.scanning = null));
    return this.scanning;
  }

  private buildEntry(rel: string, text: string, size: number, mtimeMs: number): NoteEntry {
    const { frontmatter, body } = parseNote(text);
    const basename = posix.basename(rel).replace(/\.md$/i, '');
    const title = typeof frontmatter.title === 'string' && frontmatter.title.trim() ? frontmatter.title.trim() : basename;
    const tags = [...new Set([...tagsOf(frontmatter), ...inlineTags(body)])];
    return { path: rel, title, basename, frontmatter, tags, links: wikiLinks(body), body, size, mtimeMs, version: versionOf(text) };
  }

  async notes(): Promise<NoteEntry[]> {
    await this.refresh();
    return [...this.cache.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Normalizes a note path; adds .md if missing. */
  notePath(input: string): string {
    const p = normalizeRelPath(input);
    return p.toLowerCase().endsWith('.md') ? p : `${p}.md`;
  }

  async readRaw(rel: string): Promise<{ text: string; abs: string }> {
    const abs = await resolveExisting(this.root, rel);
    if (!abs) throw new NotFoundError(`Note introuvable : ${rel}`);
    const st = await stat(abs);
    if (!st.isFile()) throw new NotFoundError(`Pas une note : ${rel}`);
    return { text: await readFile(abs, 'utf8'), abs };
  }

  async exists(rel: string): Promise<boolean> {
    try {
      return (await resolveExisting(this.root, rel)) !== null;
    } catch (e) {
      if (e instanceof PathError) throw e;
      return false;
    }
  }

  async get(rel: string): Promise<NoteEntry> {
    const { text, abs } = await this.readRaw(rel);
    const st = await stat(abs);
    const entry = this.buildEntry(rel, text, st.size, st.mtimeMs);
    this.cache.set(rel, entry);
    return entry;
  }

  /** Writes a note atomically and updates the index. */
  async write(rel: string, text: string): Promise<NoteEntry> {
    const abs = (await resolveExisting(this.root, rel)) ?? (await resolveForWrite(this.root, rel));
    await mkdir(posix.dirname(abs), { recursive: true });
    await atomicWrite(abs, text);
    const st = await stat(abs);
    const entry = this.buildEntry(rel, text, st.size, st.mtimeMs);
    this.cache.set(rel, entry);
    return entry;
  }

  async move(fromRel: string, toRel: string): Promise<void> {
    const from = await resolveExisting(this.root, fromRel);
    if (!from) throw new NotFoundError(`Note introuvable : ${fromRel}`);
    if (await this.exists(toRel)) throw new Error(`La destination existe déjà : ${toRel}`);
    const to = await resolveForWrite(this.root, toRel);
    await mkdir(posix.dirname(to), { recursive: true });
    await rename(from, to);
    this.cache.delete(fromRel);
    await this.get(toRel);
  }

  async listFolder(rel: string): Promise<{ folders: string[]; notes: string[]; files: string[] }> {
    const abs = await resolveExisting(this.root, rel);
    if (!abs) throw new NotFoundError(`Dossier introuvable : ${rel || '/'}`);
    const entries = await readdir(abs, { withFileTypes: true });
    const folders: string[] = [];
    const notes: string[] = [];
    const files: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const name = e.name.normalize('NFC');
      const p = rel ? `${rel}/${name}` : name;
      if (e.isDirectory()) folders.push(p + '/');
      else if (name.toLowerCase().endsWith('.md')) notes.push(p);
      else files.push(p);
    }
    const s = (a: string, b: string) => a.localeCompare(b);
    return { folders: folders.sort(s), notes: notes.sort(s), files: files.sort(s) };
  }

  /** Resolves a [[link]] target to note paths, the way Obsidian does (by base name or path). */
  async resolveLink(target: string): Promise<NoteEntry[]> {
    const notes = await this.notes();
    const t = target.normalize('NFC').replace(/\.md$/i, '');
    const lower = t.toLowerCase();
    if (t.includes('/')) {
      return notes.filter((n) => n.path.toLowerCase().replace(/\.md$/, '') === lower ||
        n.path.toLowerCase().replace(/\.md$/, '').endsWith('/' + lower));
    }
    return notes.filter((n) => n.basename.toLowerCase() === lower);
  }

  async search(query: string, opts: { folder?: string; tag?: string; limit?: number } = {}): Promise<SearchHit[]> {
    const notes = await this.notes();
    const terms = fold(query).split(/\s+/).filter(Boolean);
    const tagFilter = opts.tag ? opts.tag.replace(/^#/, '').toLowerCase() : undefined;
    const folder = opts.folder ? normalizeRelPath(opts.folder, { allowRoot: true }).toLowerCase() : '';
    const hits: SearchHit[] = [];
    for (const n of notes) {
      if (folder && !n.path.toLowerCase().startsWith(folder + '/')) continue;
      if (tagFilter && !n.tags.some((t) => t === tagFilter || t.startsWith(tagFilter + '/'))) continue;
      const title = fold(n.title);
      const body = fold(n.body);
      let score = 0;
      let allMatch = true;
      for (const term of terms) {
        let s = 0;
        if (title.includes(term)) s += 10;
        if (n.tags.some((t) => fold(t).includes(term))) s += 5;
        let idx = body.indexOf(term);
        let count = 0;
        while (idx !== -1 && count < 20) {
          count++;
          idx = body.indexOf(term, idx + term.length);
        }
        s += Math.min(count, 10);
        if (s === 0) allMatch = false;
        score += s;
      }
      if (terms.length === 0) score = 1;
      if (score === 0 || (!allMatch && terms.length > 1 && score < 10)) continue;
      hits.push({ path: n.path, title: n.title, score, tags: n.tags, snippet: snippet(n.body, terms) });
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, opts.limit ?? 20);
  }

  async listTags(): Promise<{ tag: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const n of await this.notes()) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  async backlinks(entry: NoteEntry): Promise<string[]> {
    const notes = await this.notes();
    const base = entry.basename.toLowerCase();
    const pathNoExt = entry.path.toLowerCase().replace(/\.md$/, '');
    return notes
      .filter((n) => n.path !== entry.path && n.links.some((l) => {
        const ll = l.toLowerCase().replace(/\.md$/, '');
        return ll === base || ll === pathNoExt || pathNoExt.endsWith('/' + ll);
      }))
      .map((n) => n.path);
  }

  async related(rel: string): Promise<{
    outgoing: { link: string; resolved: string[] }[];
    incoming: string[];
    commonTags: { path: string; title: string; shared: string[] }[];
  }> {
    const entry = await this.get(rel);
    const outgoing = [];
    for (const l of entry.links) outgoing.push({ link: l, resolved: (await this.resolveLink(l)).map((n) => n.path) });
    const incoming = await this.backlinks(entry);
    const commonTags = (await this.notes())
      .filter((n) => n.path !== entry.path)
      .map((n) => ({ path: n.path, title: n.title, shared: n.tags.filter((t) => entry.tags.includes(t)) }))
      .filter((x) => x.shared.length > 0)
      .sort((a, b) => b.shared.length - a.shared.length)
      .slice(0, 20);
    return { outgoing, incoming, commonTags };
  }

  private shinglesFor(n: NoteEntry): Set<string> {
    const c = this.shingleCache.get(n.path);
    if (c && c.version === n.version) return c.set;
    const set = shingles(n.body);
    this.shingleCache.set(n.path, { version: n.version, set });
    return set;
  }

  /** Titles similar to a candidate title (used before creating a note). */
  async similarTitles(title: string, threshold = 0.6): Promise<{ path: string; title: string; similarity: number }[]> {
    return (await this.notes())
      .map((n) => ({ path: n.path, title: n.title, similarity: Math.max(titleSimilarity(title, n.title), titleSimilarity(title, n.basename)) }))
      .filter((x) => x.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);
  }

  async findDuplicates(opts: { path?: string; titleThreshold?: number; textThreshold?: number; limit?: number } = {}) {
    const titleT = opts.titleThreshold ?? 0.7;
    const textT = opts.textThreshold ?? 0.5;
    const notes = (await this.notes()).filter((n) => !n.path.startsWith('.'));
    const targets = opts.path ? [await this.get(opts.path)] : notes;
    const pairs: { a: string; b: string; titleSimilarity: number; textOverlap: number }[] = [];
    const seen = new Set<string>();
    for (const a of targets) {
      for (const b of notes) {
        if (a.path === b.path) continue;
        const key = [a.path, b.path].sort().join('\0');
        if (seen.has(key)) continue;
        seen.add(key);
        const ts = titleSimilarity(a.title, b.title);
        const to = textOverlap(this.shinglesFor(a), this.shinglesFor(b));
        if (ts >= titleT || to >= textT) {
          pairs.push({ a: a.path, b: b.path, titleSimilarity: round(ts), textOverlap: round(to) });
        }
      }
    }
    pairs.sort((x, y) => Math.max(y.titleSimilarity, y.textOverlap) - Math.max(x.titleSimilarity, x.textOverlap));
    return pairs.slice(0, opts.limit ?? 50);
  }

  async findByFrontmatter(key: string, value: string): Promise<NoteEntry[]> {
    return (await this.notes()).filter((n) => n.frontmatter[key] === value);
  }

  async stats(): Promise<{ notes: number; bytes: number }> {
    const notes = await this.notes();
    return { notes: notes.length, bytes: notes.reduce((s, n) => s + n.size, 0) };
  }

  static serialize = serializeNote;
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

function snippet(body: string, terms: string[]): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const folded = fold(flat);
  let pos = -1;
  for (const t of terms) {
    pos = folded.indexOf(t);
    if (pos !== -1) break;
  }
  if (pos === -1) return flat.slice(0, 160);
  const start = Math.max(0, pos - 60);
  return (start > 0 ? '…' : '') + flat.slice(start, start + 180) + (start + 180 < flat.length ? '…' : '');
}
