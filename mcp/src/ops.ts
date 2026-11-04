import { posix } from 'node:path';
import { AgentError, AgentRuns } from './agent.js';
import type { Config } from './config.js';
import type { Git } from './git.js';
import type { Journal } from './journal.js';
import { Mutex, localDate, localTime } from './util.js';
import { normalizeTag, parseNote, serializeNote, type Frontmatter } from './vault/frontmatter.js';
import { normalizeRelPath, PathError, titleToFileName } from './vault/paths.js';
import type { Permissions } from './vault/permissions.js';
import { NotFoundError, versionOf, type Vault } from './vault/vault.js';

export type Endpoint = 'main' | 'agent';

export interface Ctx {
  endpoint: Endpoint;
  /** Human-readable client label (OAuth client name + id) for journal and commits. */
  client: string;
}

/** Error whose message is shown to the model as a tool error. */
export class ToolError extends Error {}

export const SOURCES = ['claude-ai', 'claude-code', 'agent', 'manual'] as const;
export const TYPES = ['knowledge', 'project', 'journal', 'index', 'report'] as const;
export const STATUSES = ['draft', 'unverified', 'validated', 'archived'] as const;

interface Plan {
  /** Paths touched (vault-relative), committed together. */
  paths: string[];
  /** Note named in the journal. */
  note: string;
  /** Human description of the change (used in simulation and results). */
  description: string;
  apply: () => Promise<string | void>;
}

interface WriteOpts {
  /** Agent tools allowed in simulation and outside the write limit. */
  agentExempt?: boolean;
}

export class Ops {
  private writeLock = new Mutex();

  constructor(
    readonly cfg: Config,
    readonly vault: Vault,
    readonly perms: Permissions,
    readonly git: Git,
    readonly journal: Journal,
    readonly agent: AgentRuns,
  ) {}

  private today(): string {
    return localDate(new Date(), this.cfg.timezone);
  }

  // ---------------------------------------------------------------- helpers

  notePath(p: string): string {
    try {
      return this.vault.notePath(p);
    } catch (e) {
      if (e instanceof PathError) throw new ToolError(e.message);
      throw e;
    }
  }

  folderPath(p: string | undefined, allowRoot = true): string {
    try {
      return normalizeRelPath(p ?? '', { allowRoot });
    } catch (e) {
      if (e instanceof PathError) throw new ToolError(e.message);
      throw e;
    }
  }

  private assertWritable(rel: string): void {
    if (!this.perms.canWrite(rel)) {
      throw new DeniedError(`Écriture refusée : « ${rel} » est en lecture seule.`);
    }
  }

  private async load(rel: string, ctx: Ctx, expectedVersion?: string) {
    let raw;
    try {
      raw = await this.vault.readRaw(rel);
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof PathError) throw new ToolError(e.message);
      throw e;
    }
    const version = versionOf(raw.text);
    if (ctx.endpoint === 'agent' && !expectedVersion) {
      throw new ToolError('expected_version est obligatoire pour l\'agent : relis la note (read_note) juste avant de la modifier.');
    }
    if (expectedVersion && expectedVersion !== version) {
      if (ctx.endpoint === 'agent') await this.agent.count('skipped');
      throw new ToolError(
        `Conflit : « ${rel} » a été modifiée depuis ta lecture (version ${version}, attendue ${expectedVersion}). ` +
          'Ne l\'écrase pas : saute cette note et signale-la dans le rapport.',
      );
    }
    return { text: raw.text, version, ...parseNote(raw.text) };
  }

  private touch(fm: Frontmatter): Frontmatter {
    return { ...fm, updated: this.today() };
  }

  /** Executes a write plan with permissions, agent rules, simulation, git commit and journal. */
  private async execute(ctx: Ctx, tool: string, build: () => Promise<Plan>, opts: WriteOpts = {}): Promise<string> {
    return this.writeLock.run(async () => {
      let plan: Plan | undefined;
      try {
        if (ctx.endpoint === 'agent') await this.agent.requireRun();
        plan = await build();
        for (const p of plan.paths) this.assertWritable(p);

        if (ctx.endpoint === 'agent' && !opts.agentExempt && this.cfg.agentMode === 'simulation') {
          await this.agent.count('simulated');
          await this.journal.write({ client: ctx.client, endpoint: ctx.endpoint, tool, note: plan.note, result: 'simulated', detail: plan.description });
          return `[SIMULATION] Action valide mais NON appliquée (mode simulation) : ${plan.description}. Décris-la dans le rapport.`;
        }
        let quota = '';
        if (ctx.endpoint === 'agent' && !opts.agentExempt) {
          const q = await this.agent.consumeWrite();
          quota = ` (écriture ${q.used}/${q.max} de ce passage)`;
        }
        const extra = (await plan.apply()) ?? '';
        const sha = await this.git.commitPaths(plan.paths, `[mcp] ${ctx.client} · ${tool} · ${plan.note}`);
        await this.journal.write({ client: ctx.client, endpoint: ctx.endpoint, tool, note: plan.note, result: 'ok', commit: sha ?? undefined });
        return `OK : ${plan.description}${quota}.${extra ? ' ' + extra : ''}`;
      } catch (e) {
        const denied = e instanceof DeniedError;
        await this.journal
          .write({ client: ctx.client, endpoint: ctx.endpoint, tool, note: plan?.note, result: denied ? 'denied' : 'error', detail: (e as Error).message })
          .catch(() => undefined);
        if (e instanceof ToolError || e instanceof AgentError || e instanceof PathError) throw new ToolError(e.message);
        throw e;
      }
    });
  }

  /** Journals a read access (no content). */
  async logRead(ctx: Ctx, tool: string, note?: string): Promise<void> {
    await this.journal.write({ client: ctx.client, endpoint: ctx.endpoint, tool, note, result: 'ok' }).catch(() => undefined);
  }

  /** Hourly commit of changes coming from devices (LiveSync). */
  async commitDeviceChanges(): Promise<string | null> {
    return this.writeLock.run(() => this.git.commitAll('[auto] modifications des appareils'));
  }

  // ---------------------------------------------------------------- writes

  async createNote(
    ctx: Ctx,
    a: {
      title: string;
      content: string;
      folder?: string;
      tags?: string[];
      type?: (typeof TYPES)[number];
      source?: (typeof SOURCES)[number];
      source_ref?: string;
      capture_id?: string;
      status?: 'draft' | 'unverified';
      allow_similar?: boolean;
    },
  ): Promise<string> {
    return this.execute(ctx, 'create_note', async () => {
      const folder = this.folderPath(a.folder?.trim() ? a.folder : this.cfg.inboxFolder);
      let base = titleToFileName(a.title);
      const today = this.today();
      if (folder === this.cfg.reportFolder && !/^\d{4}-\d{2}-\d{2}/.test(base)) base = `${today} ${base}`;
      const rel = folder ? `${folder}/${base}.md` : `${base}.md`;
      this.assertWritable(rel);
      if (await this.vault.exists(rel)) {
        throw new ToolError(`La note « ${rel} » existe déjà : utilise append_to_note ou update_note.`);
      }
      if (a.capture_id) {
        const dup = await this.vault.findByFrontmatter('capture_id', a.capture_id);
        if (dup.length) throw new ToolError(`Déjà capturé (capture_id identique) : ${dup.map((d) => d.path).join(', ')}. Rien à faire.`);
      }
      const sameName = await this.vault.resolveLink(base);
      if (sameName.length) {
        throw new ToolError(`Une note porte déjà ce nom : ${sameName.map((n) => n.path).join(', ')}. Complète-la avec append_to_note.`);
      }
      if (!a.allow_similar) {
        const similar = (await this.vault.similarTitles(a.title, 0.75)).filter((s) => s.path !== rel);
        if (similar.length) {
          throw new ToolError(
            'Doublon probable, note non créée. Notes proches : ' +
              similar.map((s) => `« ${s.title} » (${s.path}, ${Math.round(s.similarity * 100)} %)`).join(' ; ') +
              '. Complète la note existante avec append_to_note, ou rappelle create_note avec allow_similar=true si le concept est vraiment distinct.',
          );
        }
      }
      const source = ctx.endpoint === 'agent' ? 'agent' : (a.source ?? 'claude-ai');
      if (ctx.endpoint !== 'agent' && source === 'agent') throw new ToolError('source=agent est réservé à l\'agent nocturne.');
      const fm: Frontmatter = {
        title: a.title.trim(),
        created: today,
        updated: today,
        type: a.type ?? 'knowledge',
        source,
        source_ref: a.source_ref ?? '',
        captured: today,
        ...(a.capture_id ? { capture_id: a.capture_id } : {}),
        tags: [...new Set((a.tags ?? []).map(normalizeTag).filter(Boolean))],
        status: a.status ?? 'draft',
      };
      const body = a.content.endsWith('\n') ? a.content : a.content + '\n';
      return {
        paths: [rel],
        note: rel,
        description: `création de « ${rel} »`,
        apply: async () => {
          await this.vault.write(rel, serializeNote(fm, body));
          return `Chemin : ${rel}`;
        },
      };
    });
  }

  async appendToNote(ctx: Ctx, a: { path: string; content: string; heading?: string; expected_version?: string }): Promise<string> {
    return this.execute(ctx, 'append_to_note', async () => {
      const rel = this.notePath(a.path);
      this.assertWritable(rel);
      const n = await this.load(rel, ctx, a.expected_version);
      const addition = a.content.trim();
      if (!addition) throw new ToolError('Contenu vide.');
      let body: string;
      if (a.heading) body = insertUnderHeading(n.body, a.heading, addition);
      else body = n.body.replace(/\s*$/, '') + '\n\n' + addition + '\n';
      return {
        paths: [rel],
        note: rel,
        description: `ajout de ${addition.length} caractères à « ${rel} »${a.heading ? ` (section ${a.heading})` : ''}`,
        apply: async () => void (await this.vault.write(rel, serializeNote(this.touch(n.frontmatter), body))),
      };
    });
  }

  async updateNote(ctx: Ctx, a: { path: string; old_text: string; new_text: string; expected_version?: string }): Promise<string> {
    return this.execute(ctx, 'update_note', async () => {
      const rel = this.notePath(a.path);
      this.assertWritable(rel);
      const n = await this.load(rel, ctx, a.expected_version);
      if (!a.old_text) throw new ToolError('old_text est vide.');
      const count = n.body.split(a.old_text).length - 1;
      if (count === 0) throw new ToolError('old_text introuvable dans le corps de la note (le frontmatter se modifie avec set_frontmatter).');
      if (count > 1) throw new ToolError(`old_text apparaît ${count} fois : donne un extrait plus long et unique.`);
      if (ctx.endpoint === 'agent' && a.old_text.length > 200 && a.old_text.length > 0.3 * n.body.length) {
        throw new ToolError('Réécriture importante interdite à l\'agent : utilise propose_action (kind=rewrite).');
      }
      const body = n.body.replace(a.old_text, () => a.new_text);
      return {
        paths: [rel],
        note: rel,
        description: `remplacement de ${a.old_text.length} caractères dans « ${rel} »`,
        apply: async () => void (await this.vault.write(rel, serializeNote(this.touch(n.frontmatter), body))),
      };
    });
  }

  async setFrontmatter(ctx: Ctx, a: { path: string; fields: Record<string, unknown>; expected_version?: string }): Promise<string> {
    return this.execute(ctx, 'set_frontmatter', async () => {
      const rel = this.notePath(a.path);
      this.assertWritable(rel);
      const n = await this.load(rel, ctx, a.expected_version);
      const fm: Frontmatter = { ...n.frontmatter };
      const changed: string[] = [];
      for (const [k, v] of Object.entries(a.fields)) {
        if (!/^[\p{L}\p{N}_\-]+$/u.test(k)) throw new ToolError(`Clé invalide : ${k}`);
        if (k === 'created' || k === 'captured' || k === 'updated') throw new ToolError(`« ${k} » est géré automatiquement.`);
        if (k === 'capture_id' && fm.capture_id !== undefined) throw new ToolError('capture_id est immuable.');
        if (k === 'status') this.checkStatus(ctx, fm.status, v);
        if (k === 'type' && v !== null && !TYPES.includes(v as never)) throw new ToolError(`type invalide (${TYPES.join(' | ')}).`);
        if (k === 'source' && v !== null && !SOURCES.includes(v as never)) throw new ToolError(`source invalide (${SOURCES.join(' | ')}).`);
        if (k === 'title' && ctx.endpoint === 'agent' && v !== fm.title) {
          throw new ToolError('Changement de titre interdit à l\'agent : utilise propose_action (kind=rename).');
        }
        if (k === 'tags') {
          if (!Array.isArray(v)) throw new ToolError('tags doit être une liste.');
          fm.tags = [...new Set(v.map((t) => normalizeTag(String(t))).filter(Boolean))];
        } else if (v === null) {
          delete fm[k];
        } else {
          fm[k] = v;
        }
        changed.push(k);
      }
      if (!changed.length) throw new ToolError('Aucun champ fourni.');
      return {
        paths: [rel],
        note: rel,
        description: `frontmatter de « ${rel} » : ${changed.map((k) => `${k}=${JSON.stringify(a.fields[k])}`).join(', ')}`,
        apply: async () => void (await this.vault.write(rel, serializeNote(this.touch(fm), n.body))),
      };
    });
  }

  private checkStatus(ctx: Ctx, from: unknown, to: unknown): void {
    if (!STATUSES.includes(to as never)) throw new ToolError(`status invalide (${STATUSES.join(' | ')}).`);
    if (to === from) return;
    if (to === 'validated') throw new ToolError('Seul le propriétaire du vault passe une note en « validated » (dans Obsidian).');
    if (ctx.endpoint === 'agent') {
      if (!(to === 'unverified' && (from === 'draft' || from === undefined))) {
        throw new ToolError('L\'agent ne peut faire que draft → unverified. Pour archiver, utilise propose_action (kind=archive).');
      }
    }
  }

  async addTags(ctx: Ctx, a: { path: string; tags: string[]; expected_version?: string }): Promise<string> {
    return this.execute(ctx, 'add_tags', async () => {
      const rel = this.notePath(a.path);
      this.assertWritable(rel);
      const n = await this.load(rel, ctx, a.expected_version);
      const existing = Array.isArray(n.frontmatter.tags) ? n.frontmatter.tags.map((t) => normalizeTag(String(t))) : [];
      const add = a.tags.map(normalizeTag).filter((t) => t && !existing.includes(t));
      if (!add.length) throw new ToolError('Ces tags sont déjà présents.');
      const fm = { ...n.frontmatter, tags: [...existing, ...new Set(add)] };
      return {
        paths: [rel],
        note: rel,
        description: `tags ajoutés à « ${rel} » : ${add.join(', ')}`,
        apply: async () => void (await this.vault.write(rel, serializeNote(this.touch(fm), n.body))),
      };
    });
  }

  async addLink(ctx: Ctx, a: { path: string; target: string; context?: string; heading?: string; expected_version?: string }): Promise<string> {
    return this.execute(ctx, 'add_link', async () => {
      const rel = this.notePath(a.path);
      this.assertWritable(rel);
      const n = await this.load(rel, ctx, a.expected_version);
      const target = a.target.replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '').trim();
      const resolved = await this.vault.resolveLink(target);
      if (!resolved.length) throw new ToolError(`Cible introuvable : [[${target}]] ne correspond à aucune note (utilise le nom de fichier sans .md).`);
      if (resolved.length > 1 && !target.includes('/')) {
        throw new ToolError(`Cible ambiguë : ${resolved.map((r) => r.path).join(', ')}. Précise le chemin.`);
      }
      if (resolved[0]!.path === rel) throw new ToolError('Une note ne se lie pas à elle-même.');
      if (n.body.includes(`[[${target}]]`) || n.body.includes(`[[${target}|`)) throw new ToolError('Ce lien existe déjà dans la note.');
      const line = `- [[${target}]]${a.context ? ` — ${a.context.replace(/\n/g, ' ')}` : ''}`;
      const body = insertUnderHeading(n.body, a.heading ?? 'Liens', line, true);
      return {
        paths: [rel],
        note: rel,
        description: `lien [[${target}]] ajouté dans « ${rel} »`,
        apply: async () => void (await this.vault.write(rel, serializeNote(this.touch(n.frontmatter), body))),
      };
    });
  }

  async moveNote(ctx: Ctx, a: { path: string; folder: string; expected_version?: string }): Promise<string> {
    return this.execute(ctx, 'move_note', async () => {
      const rel = this.notePath(a.path);
      const folder = this.folderPath(a.folder);
      const dest = folder ? `${folder}/${posix.basename(rel)}` : posix.basename(rel);
      this.assertWritable(rel);
      this.assertWritable(dest);
      if (dest === rel) throw new ToolError('La note est déjà dans ce dossier.');
      if (ctx.endpoint === 'agent' && !rel.toLowerCase().startsWith(this.cfg.inboxFolder.toLowerCase() + '/')) {
        throw new ToolError(`L'agent ne déplace que depuis ${this.cfg.inboxFolder}/ : pour le reste, utilise propose_action.`);
      }
      if (ctx.endpoint === 'agent' && folder.toLowerCase().startsWith('90-archives')) {
        throw new ToolError('Archivage interdit à l\'agent : utilise propose_action (kind=archive).');
      }
      const n = await this.load(rel, ctx, a.expected_version);
      if (ctx.endpoint === 'agent' && n.frontmatter.type === 'index') {
        throw new ToolError('Les notes d\'index restent dans leur dossier : ne les déplace pas.');
      }
      if (await this.vault.exists(dest)) throw new ToolError(`« ${dest} » existe déjà.`);
      return {
        paths: [rel, dest],
        note: `${rel} → ${dest}`,
        description: `déplacement de « ${rel} » vers « ${dest} »`,
        apply: async () => {
          await this.vault.move(rel, dest);
          return `Nouveau chemin : ${dest}`;
        },
      };
    });
  }

  // ---------------------------------------------------------------- agent

  async getChangesSince(ctx: Ctx, a: { since?: string }) {
    const run = await this.writeLock.run(() => this.agent.start());
    let base: string | null = run.sinceSha;
    if (a.since) {
      const d = new Date(a.since);
      if (Number.isNaN(d.getTime())) throw new ToolError('since doit être une date ISO 8601.');
      base = await this.git.lastCommitBefore(d);
    }
    let changes: { status: string; path: string; from?: string }[];
    if (base) {
      changes = await this.git.changedSince(base);
    } else {
      changes = (await this.vault.notes()).map((n) => ({ status: 'A', path: n.path }));
    }
    const notes = [];
    for (const c of changes) {
      const p = c.path.normalize('NFC');
      if (!p.toLowerCase().endsWith('.md') || p.split('/').some((s) => s.startsWith('.'))) continue;
      if (c.status === 'D') {
        notes.push({ change: 'supprimée', path: p });
        continue;
      }
      const entry = await this.vault.get(p).catch(() => null);
      if (!entry) continue;
      notes.push({
        change: c.status === 'A' ? 'créée' : c.status === 'R' ? `renommée (depuis ${c.from})` : 'modifiée',
        path: p,
        title: entry.title,
        status: entry.frontmatter.status ?? null,
        writable: this.perms.canWrite(p),
        version: entry.version,
      });
    }
    await this.logRead(ctx, 'get_changes_since');
    return {
      run: { started_at: run.startedAt, mode: this.cfg.agentMode, max_writes: this.cfg.agentMaxWrites, writes_used: run.writes },
      since: a.since ?? (base ? `dernier passage (${base.slice(0, 8)})` : 'début (premier passage : toutes les notes)'),
      count: notes.length,
      notes,
    };
  }

  async writeReport(ctx: Ctx, a: { content: string; errors?: string[] }): Promise<string> {
    let reportRel = '';
    const result = await this.execute(
      ctx,
      'write_report',
      async () => {
        const run = await this.agent.requireRun();
        const now = new Date();
        const date = localDate(now, this.cfg.timezone);
        const rel = `${this.cfg.reportFolder}/${date} Rapport agent.md`;
        reportRel = rel;
        const header =
          `## Passage de ${localTime(now, this.cfg.timezone)}\n\n` +
          `- Mode : ${this.cfg.agentMode === 'simulation' ? 'simulation (aucune modification appliquée)' : 'réel'}\n` +
          `- Écritures appliquées : ${run.writes}/${this.cfg.agentMaxWrites}\n` +
          `- Actions simulées : ${run.simulated}\n` +
          `- Notes sautées (conflit) : ${run.skipped}\n`;
        const errors = a.errors?.length ? `\n### Erreurs\n\n${a.errors.map((e) => `- ${e}`).join('\n')}\n` : '';
        const section = `${header}\n${a.content.trim()}\n${errors}`;
        let text: string;
        if (await this.vault.exists(rel)) {
          const n = parseNote((await this.vault.readRaw(rel)).text);
          text = serializeNote(this.touch(n.frontmatter), n.body.replace(/\s*$/, '') + '\n\n---\n\n' + section);
        } else {
          const fm: Frontmatter = {
            title: `Rapport agent ${date}`, created: date, updated: date, type: 'report', source: 'agent',
            source_ref: '', captured: date, tags: ['rapport-agent'], status: 'unverified',
          };
          text = serializeNote(fm, `# Rapport de l'agent — ${date}\n\n${section}`);
        }
        return {
          paths: [rel],
          note: rel,
          description: `rapport écrit dans « ${rel} »`,
          apply: async () => void (await this.vault.write(rel, text)),
        };
      },
      { agentExempt: true },
    );
    await this.writeLock.run(() => this.agent.finish(reportRel));
    return `${result} Passage clôturé.`;
  }

  async proposeAction(
    ctx: Ctx,
    a: { kind: 'merge' | 'archive' | 'rewrite' | 'rename' | 'other'; notes: string[]; rationale: string; details?: string },
  ): Promise<string> {
    return this.execute(
      ctx,
      'propose_action',
      async () => {
        const rel = this.notePath(this.cfg.proposalsNote);
        const labels = { merge: 'Fusion', archive: 'Archivage', rewrite: 'Réécriture', rename: 'Changement de titre', other: 'Autre' };
        const links = a.notes.map((p) => `[[${posix.basename(p).replace(/\.md$/i, '')}]]`).join(' + ');
        const details = a.details ? '\n' + a.details.trim().split('\n').map((l) => `    ${l}`).join('\n') : '';
        const item = `- [ ] **${labels[a.kind]}** : ${links} — ${a.rationale.replace(/\n/g, ' ')} _(proposé le ${this.today()})_${details}`;
        let text: string;
        if (await this.vault.exists(rel)) {
          const n = parseNote((await this.vault.readRaw(rel)).text);
          text = serializeNote(this.touch(n.frontmatter), n.body.replace(/\s*$/, '') + '\n' + item + '\n');
        } else {
          const d = this.today();
          const fm: Frontmatter = { title: 'À valider', created: d, updated: d, type: 'index', source: 'agent', source_ref: '', captured: d, tags: ['a-valider'], status: 'unverified' };
          text = serializeNote(fm, `# À valider\n\nPropositions de l'agent. Coche une case une fois traitée.\n\n${item}\n`);
        }
        return {
          paths: [rel],
          note: rel,
          description: `proposition « ${labels[a.kind]} » ajoutée à « ${rel} »`,
          apply: async () => void (await this.vault.write(rel, text)),
        };
      },
      { agentExempt: true },
    );
  }
}

export class DeniedError extends ToolError {}

/**
 * Inserts text at the end of the section under `heading` (any level).
 * If the heading does not exist, appends a new `## heading` section.
 */
export function insertUnderHeading(body: string, heading: string, text: string, list = false): string {
  const lines = body.split('\n');
  const h = heading.replace(/^#+\s*/, '').trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]!);
    if (m && m[2]!.trim().toLowerCase() === h) {
      start = i;
      level = m[1]!.length;
      break;
    }
  }
  if (start === -1) return body.replace(/\s*$/, '') + `\n\n## ${heading.replace(/^#+\s*/, '').trim()}\n\n${text}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
  const block = list ? [text] : ['', text];
  if (!list && insertAt === start + 1) block.shift();
  const after = end < lines.length ? [''] : [];
  const rest = lines.slice(end);
  return [...lines.slice(0, insertAt), ...(insertAt === start + 1 ? [''] : []), ...block, ...after, ...rest].join('\n').replace(/\n{3,}/g, '\n\n');
}
