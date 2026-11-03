import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ToolError, type Ctx } from '../src/ops.js';
import { setup, seed } from './helpers.js';

const user: Ctx = { endpoint: 'main', client: 'test' };
const agent: Ctx = { endpoint: 'agent', client: 'agent' };

function gitLog(dir: string): string[] {
  return execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
}

describe('write tools', () => {
  it('creates a note with frontmatter and commits it', async () => {
    const s = await setup();
    const r = await s.ops.createNote(user, { title: 'Fonctionnement de Docker Compose', content: '# Docker\n\nTexte.', tags: ['Docker', 'Reverse Proxy'] });
    expect(r).toContain('00-Inbox/Fonctionnement de Docker Compose.md');
    const text = await readFile(join(s.vaultDir, '00-Inbox/Fonctionnement de Docker Compose.md'), 'utf8');
    expect(text).toMatch(/^---\ntitle: Fonctionnement de Docker Compose\ncreated: \d{4}-\d{2}-\d{2}/);
    expect(text).toContain('status: draft');
    expect(text).toContain('- reverse-proxy');
    expect(text).toContain('source: claude-ai');
    expect(gitLog(s.vaultDir)[0]).toContain('create_note');
  });

  it('uses 00-Inbox when folder is empty', async () => {
    const s = await setup();
    expect(await s.ops.createNote(user, { title: 'Sans dossier', content: 'x', folder: '' })).toContain('00-Inbox/Sans dossier.md');
  });

  it('refuses duplicates and repeated captures', async () => {
    const s = await setup();
    await s.ops.createNote(user, { title: 'Réseaux Docker Compose', content: 'a', capture_id: 'sess1:reseaux' });
    await expect(s.ops.createNote(user, { title: 'Réseaux Docker Compose', content: 'b' })).rejects.toThrow(/existe déjà/);
    await expect(s.ops.createNote(user, { title: 'Autre', content: 'b', capture_id: 'sess1:reseaux' })).rejects.toThrow(/Déjà capturé/);
    await expect(s.ops.createNote(user, { title: 'Réseau Docker Compose', content: 'b' })).rejects.toThrow(/Doublon probable/);
    await expect(s.ops.createNote(user, { title: 'Réseau Docker Compose', content: 'b', allow_similar: true })).resolves.toContain('OK');
  });

  it('T17: refuses writes in read-only folders', async () => {
    const s = await setup();
    await expect(s.ops.createNote(user, { title: 'X', content: 'x', folder: '20-Domaines/Pro' })).rejects.toThrow(/lecture seule/);
    await seed(s.vaultDir, '20-Domaines/Pro/Note.md', 'contenu');
    await expect(s.ops.appendToNote(user, { path: '20-Domaines/Pro/Note.md', content: 'y' })).rejects.toThrow(/lecture seule/);
    await seed(s.vaultDir, '00-Inbox/A.md', 'a');
    await expect(s.ops.moveNote(user, { path: '00-Inbox/A.md', folder: '99-Système' })).rejects.toThrow(/lecture seule/);
    const journal = await readFile(join(s.stateDir, 'journal.jsonl'), 'utf8');
    expect(journal).toContain('"result":"denied"');
  });

  it('detects concurrent modifications with expected_version', async () => {
    const s = await setup();
    await seed(s.vaultDir, '30-Connaissances/N.md', '---\ntitle: N\n---\nCorps initial\n');
    const v = (await s.vault.get('30-Connaissances/N.md')).version;
    await seed(s.vaultDir, '30-Connaissances/N.md', '---\ntitle: N\n---\nModifié sur iPhone\n');
    await expect(s.ops.updateNote(user, { path: '30-Connaissances/N.md', old_text: 'Modifié', new_text: 'X', expected_version: v })).rejects.toThrow(/Conflit/);
  });

  it('never lets a client set status=validated', async () => {
    const s = await setup();
    await s.ops.createNote(user, { title: 'Note', content: 'x' });
    await expect(s.ops.setFrontmatter(user, { path: '00-Inbox/Note.md', fields: { status: 'validated' } })).rejects.toThrow(/validated/);
  });

  it('add_link requires an existing target and writes a valid wikilink (T10)', async () => {
    const s = await setup();
    await seed(s.vaultDir, '30-Connaissances/Cible.md', 'x');
    await seed(s.vaultDir, '30-Connaissances/Source.md', '# Source\n\nTexte.\n');
    await expect(s.ops.addLink(user, { path: '30-Connaissances/Source.md', target: 'Inexistante' })).rejects.toThrow(/introuvable/);
    await s.ops.addLink(user, { path: '30-Connaissances/Source.md', target: 'Cible', context: 'même sujet' });
    const text = await readFile(join(s.vaultDir, '30-Connaissances/Source.md'), 'utf8');
    expect(text).toContain('## Liens\n\n- [[Cible]] — même sujet');
    const rel = await s.vault.related('30-Connaissances/Source.md');
    expect(rel.outgoing[0]!.resolved).toEqual(['30-Connaissances/Cible.md']);
  });
});

describe('read tools', () => {
  it('searches accent-insensitively and finds duplicates', async () => {
    const s = await setup();
    const body = 'Le reverse proxy termine le TLS et redirige les requêtes vers les conteneurs du réseau interne de la stack.';
    await seed(s.vaultDir, '30-Connaissances/Reverse proxy.md', `---\ntags: [reverse-proxy]\n---\n${body}\n`);
    await seed(s.vaultDir, '00-Inbox/Proxy inverse.md', `${body} Copie.\n`);
    const hits = await s.vault.search('requetes reseau');
    expect(hits.map((h) => h.path)).toContain('30-Connaissances/Reverse proxy.md');
    const dups = await s.vault.findDuplicates();
    expect(dups[0]!.textOverlap).toBeGreaterThan(0.8);
  });
});

describe('agent endpoint', () => {
  it('requires a run, simulates writes, and reports (T08/T09)', async () => {
    const s = await setup({ AGENT_MODE: 'simulation' });
    await seed(s.vaultDir, '00-Inbox/Capture.md', '---\ntitle: Capture\nstatus: draft\n---\nTexte\n');
    await expect(s.ops.addTags(agent, { path: '00-Inbox/Capture.md', tags: ['x'], expected_version: 'x' })).rejects.toThrow(/get_changes_since/);
    const changes = await s.ops.getChangesSince(agent, {});
    expect(changes.notes.map((n) => n.path)).toContain('00-Inbox/Capture.md');
    const v = changes.notes.find((n) => n.path === '00-Inbox/Capture.md')!.version!;
    const r = await s.ops.moveNote(agent, { path: '00-Inbox/Capture.md', folder: '30-Connaissances', expected_version: v });
    expect(r).toContain('[SIMULATION]');
    expect(await s.vault.exists('00-Inbox/Capture.md')).toBe(true);
    await s.ops.proposeAction(agent, { kind: 'merge', notes: ['00-Inbox/Capture.md', '30-Connaissances/X.md'], rationale: 'doublon' });
    const prop = await readFile(join(s.vaultDir, '40-Journal/À valider.md'), 'utf8');
    expect(prop).toContain('- [ ] **Fusion** : [[Capture]] + [[X]]');
    await s.ops.writeReport(agent, { content: 'Rien à signaler.', errors: ['erreur test'] });
    const notes = await s.vault.notes();
    const report = notes.find((n) => n.path.endsWith('Rapport agent.md'))!;
    expect(report.body).toContain('Actions simulées : 1');
    expect(report.body).toContain('- erreur test');
    expect(await s.ops.agent.active()).toBeNull();
    const log = gitLog(s.vaultDir);
    // Markers always exist, so `git revert avant..après` undoes exactly one run.
    expect(log[0]).toBe('[agent] après passage');
    expect(log).toContain('[agent] avant passage');
  });

  it('applies writes in real mode with a per-run limit and agent restrictions', async () => {
    const s = await setup({ AGENT_MODE: 'real', AGENT_MAX_WRITES: '1' });
    await seed(s.vaultDir, '00-Inbox/A.md', '---\nstatus: draft\n---\nA\n');
    await seed(s.vaultDir, '30-Connaissances/B.md', '---\nstatus: draft\n---\nB\n');
    await s.ops.getChangesSince(agent, {});
    const va = (await s.vault.get('00-Inbox/A.md')).version;
    const vb = (await s.vault.get('30-Connaissances/B.md')).version;
    await expect(s.ops.setFrontmatter(agent, { path: '00-Inbox/A.md', fields: { status: 'archived' }, expected_version: va })).rejects.toThrow(ToolError);
    await expect(s.ops.addTags(agent, { path: '00-Inbox/A.md', tags: ['x'] })).rejects.toThrow(/expected_version/);
    await expect(s.ops.moveNote(agent, { path: '30-Connaissances/B.md', folder: '10-Projets', expected_version: vb })).rejects.toThrow(/ne déplace que/);
    await s.ops.setFrontmatter(agent, { path: '00-Inbox/A.md', fields: { status: 'unverified' }, expected_version: va });
    await expect(s.ops.addTags(agent, { path: '30-Connaissances/B.md', tags: ['y'], expected_version: vb })).rejects.toThrow(/Limite de 1/);
    await s.ops.writeReport(agent, { content: 'ok' });
    // Next run only sees changes made after the previous one.
    await seed(s.vaultDir, '30-Connaissances/C.md', 'nouvelle');
    const next = await s.ops.getChangesSince(agent, {});
    expect(next.notes.map((n) => n.path)).toEqual(['30-Connaissances/C.md']);
  });
});
