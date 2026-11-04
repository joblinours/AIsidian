import { readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Git } from '../../mcp/src/git.js';
import { Journal } from '../../mcp/src/journal.js';
import { localDate, Mutex } from '../../mcp/src/util.js';
import { parseNote, serializeNote, type Frontmatter } from '../../mcp/src/vault/frontmatter.js';
import { normalizeRelPath, PathError, resolveExisting, titleToFileName } from '../../mcp/src/vault/paths.js';
import { NotFoundError, Vault, versionOf } from '../../mcp/src/vault/vault.js';
import type { WebConfig } from './config.js';

/** Error with an HTTP status, message shown to the user. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const MAX_NOTE_BYTES = 2 * 1024 * 1024;

/**
 * Vault operations for the web UI. Same rights as Obsidian: every folder is
 * writable, but there is no delete, paths stay inside the vault (no hidden
 * folder, no symlink) and every write is a git commit plus a journal line.
 */
export class VaultApi {
  readonly vault: Vault;
  readonly git: Git;
  private journal: Journal;
  private lock = new Mutex();

  constructor(private cfg: WebConfig) {
    this.vault = new Vault(cfg.vaultDir);
    this.git = new Git(cfg.vaultDir, { name: cfg.gitAuthorName, email: cfg.gitAuthorEmail });
    this.journal = new Journal(cfg.stateDir);
  }

  async init(): Promise<void> {
    await this.git.init();
  }

  private notePath(p: unknown): string {
    if (typeof p !== 'string') throw new ApiError(400, 'Chemin manquant');
    try {
      return this.vault.notePath(p);
    } catch (e) {
      if (e instanceof PathError) throw new ApiError(400, e.message);
      throw e;
    }
  }

  private folderPath(p: unknown): string {
    if (p !== undefined && typeof p !== 'string') throw new ApiError(400, 'Dossier invalide');
    try {
      return normalizeRelPath((p as string | undefined) ?? '', { allowRoot: true });
    } catch (e) {
      if (e instanceof PathError) throw new ApiError(400, e.message);
      throw e;
    }
  }

  private async commit(paths: string[], action: string, note: string): Promise<void> {
    const sha = await this.git.commitPaths(paths, `[web] ${action} · ${note}`);
    await this.journal.write({ client: 'web', endpoint: 'main', tool: action, note, result: 'ok', commit: sha ?? undefined });
  }

  /** Folders (including empty ones) and notes. */
  async tree(): Promise<{ folders: string[]; notes: { path: string; title: string; folder: string }[] }> {
    const folders: string[] = [];
    const walk = async (abs: string, rel: string) => {
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || !e.isDirectory() || e.isSymbolicLink()) continue;
        const r = rel ? `${rel}/${e.name.normalize('NFC')}` : e.name.normalize('NFC');
        folders.push(r);
        await walk(join(abs, e.name), r);
      }
    };
    await walk(this.cfg.vaultDir, '');
    const notes = (await this.vault.notes()).map((n) => ({ path: n.path, title: n.title, folder: posix.dirname(n.path) === '.' ? '' : posix.dirname(n.path) }));
    return { folders: folders.sort((a, b) => a.localeCompare(b)), notes };
  }

  async read(pathArg: unknown) {
    const rel = this.notePath(pathArg);
    let raw;
    try {
      raw = await this.vault.readRaw(rel);
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof PathError) throw new ApiError(404, e.message);
      throw e;
    }
    const entry = await this.vault.get(rel);
    const links = [];
    for (const l of entry.links) {
      const r = await this.vault.resolveLink(l);
      links.push({ target: l, path: r[0]?.path ?? null });
    }
    const backlinks = (await this.vault.backlinks(entry)).map((p) => ({ path: p, title: posix.basename(p).replace(/\.md$/i, '') }));
    return {
      path: rel,
      title: entry.title,
      folder: posix.dirname(rel) === '.' ? '' : posix.dirname(rel),
      text: raw.text,
      version: versionOf(raw.text),
      links,
      backlinks,
      modified: new Date(entry.mtimeMs).toISOString(),
    };
  }

  async save(body: { path?: unknown; text?: unknown; expected_version?: unknown }) {
    const rel = this.notePath(body.path);
    if (typeof body.text !== 'string') throw new ApiError(400, 'Texte manquant');
    if (Buffer.byteLength(body.text) > MAX_NOTE_BYTES) throw new ApiError(413, 'Note trop volumineuse');
    if (typeof body.expected_version !== 'string') throw new ApiError(400, 'expected_version manquant');
    return this.lock.run(async () => {
      let current;
      try {
        current = await this.vault.readRaw(rel);
      } catch (e) {
        if (e instanceof NotFoundError) throw new ApiError(404, 'Note introuvable (supprimée ailleurs ?)');
        throw e;
      }
      const currentVersion = versionOf(current.text);
      if (currentVersion !== body.expected_version) {
        throw new ApiError(409, 'La note a été modifiée ailleurs depuis son ouverture.', { version: currentVersion });
      }
      let text = body.text as string;
      const parsed = parseNote(text);
      if (parsed.hasFrontmatter && 'updated' in parsed.frontmatter) {
        text = serializeNote({ ...parsed.frontmatter, updated: localDate(new Date(), this.cfg.timezone) }, parsed.body);
      }
      if (text !== current.text) {
        await this.vault.write(rel, text);
        await this.commit([rel], 'save', rel);
      }
      return this.read(rel);
    });
  }

  async create(body: { title?: unknown; folder?: unknown }) {
    if (typeof body.title !== 'string' || !body.title.trim()) throw new ApiError(400, 'Titre manquant');
    const title = body.title.trim();
    const folder = this.folderPath(body.folder ?? this.cfg.inboxFolder);
    let base;
    try {
      base = titleToFileName(title);
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
    const today = localDate(new Date(), this.cfg.timezone);
    const rel = folder ? `${folder}/${base}.md` : `${base}.md`;
    return this.lock.run(async () => {
      if (await this.vault.exists(rel)) throw new ApiError(409, `« ${rel} » existe déjà.`);
      const fm: Frontmatter = {
        title, created: today, updated: today, type: 'knowledge', source: 'manual',
        source_ref: '', captured: today, tags: [], status: 'draft',
      };
      await this.vault.write(rel, serializeNote(fm, `# ${title}\n\n`));
      await this.commit([rel], 'create', rel);
      return this.read(rel);
    });
  }

  /** Imports Markdown files into the inbox; never overwrites (adds " (2)", " (3)"…). */
  async importFiles(body: { files?: unknown }) {
    if (!Array.isArray(body.files) || body.files.length === 0) throw new ApiError(400, 'Aucun fichier');
    if (body.files.length > 50) throw new ApiError(400, '50 fichiers maximum par import');
    const files = body.files.map((f) => {
      const o = f as { name?: unknown; text?: unknown };
      if (typeof o.name !== 'string' || typeof o.text !== 'string') throw new ApiError(400, 'Fichier invalide');
      if (Buffer.byteLength(o.text) > MAX_NOTE_BYTES) throw new ApiError(413, `${o.name} : trop volumineux`);
      return { name: o.name.replace(/\.(md|markdown|txt)$/i, ''), text: o.text };
    });
    return this.lock.run(async () => {
      const written: string[] = [];
      for (const f of files) {
        let base;
        try {
          base = titleToFileName(f.name);
        } catch {
          base = 'Import';
        }
        let rel = `${this.cfg.inboxFolder}/${base}.md`;
        for (let i = 2; await this.vault.exists(rel); i++) rel = `${this.cfg.inboxFolder}/${base} (${i}).md`;
        await this.vault.write(rel, f.text.endsWith('\n') ? f.text : f.text + '\n');
        written.push(rel);
      }
      await this.commit(written, 'import', `${written.length} fichier(s)`);
      return { paths: written };
    });
  }

  async graph() {
    const notes = await this.vault.notes();
    const edges: [string, string][] = [];
    const seen = new Set<string>();
    for (const n of notes) {
      for (const l of n.links) {
        const target = (await this.vault.resolveLink(l))[0];
        if (!target || target.path === n.path) continue;
        const key = [n.path, target.path].sort().join('\0');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([n.path, target.path]);
      }
    }
    return { nodes: notes.map((n) => ({ path: n.path, title: n.title })), edges };
  }

  async search(q: unknown) {
    if (typeof q !== 'string' || !q.trim()) return { results: [] };
    return { results: await this.vault.search(q, { limit: 50 }) };
  }

  async status() {
    const [stats, commit] = await Promise.all([this.vault.stats(), this.git.lastCommit()]);
    return { notes: stats.notes, bytes: stats.bytes, lastCommit: commit };
  }

  /** Checks that a path exists (used to validate the vault mount at startup). */
  async ready(): Promise<boolean> {
    return (await resolveExisting(this.cfg.vaultDir, '')) !== null;
  }
}
