import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as OTPAuth from 'otpauth';
import { Account } from '../../mcp/src/auth/account.js';
import { createWebApp } from '../server/app.js';
import { WebAuth } from '../server/auth.js';
import { loadWebConfig } from '../server/config.js';
import { VaultApi } from '../server/vaultApi.js';

const PW = 'mot de passe web test';

async function setup(withAccount = true) {
  const root = await mkdtemp(join(tmpdir(), 'aisidian-web-'));
  const vault = join(root, 'vault');
  const mcpState = join(root, 'mcp-state');
  await mkdir(join(vault, '00-Inbox'), { recursive: true });
  await mkdir(join(vault, '99-Système'), { recursive: true });
  await writeFile(join(vault, '30-A.md'), '---\ntitle: A\nupdated: 2020-01-01\n---\n# A\n\nVoir [[B]].\n');
  await writeFile(join(vault, '00-Inbox', 'B.md'), '# B\n');
  let totp: OTPAuth.TOTP | null = null;
  if (withAccount) {
    const acc = new Account(mcpState);
    const t = (await acc.ensureSetupToken())!;
    const { secret } = acc.pendingSecret(t);
    totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
    await acc.completeSetup(t, PW, totp.generate({ timestamp: Date.now() - 30_000 }));
  }
  const cfg = loadWebConfig({
    WEB_PUBLIC_URL: 'http://localhost:8090', VAULT_DIR: vault, STATE_DIR: join(root, 'web-state'),
    ACCOUNT_FILE: join(mcpState, 'account.json'), STATIC_DIR: join(root, 'public'),
  });
  const api = new VaultApi(cfg);
  await api.init();
  const app = createWebApp({ cfg, auth: new WebAuth(cfg), api });
  return { app, vault, totp };
}

async function login(app: Awaited<ReturnType<typeof setup>>['app'], totp: OTPAuth.TOTP) {
  const r = await request(app).post('/api/login').set('x-aisidian', '1').send({ password: PW, totp: totp.generate() });
  expect(r.status).toBe(200);
  const cookie = r.headers['set-cookie']![0]!;
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Strict/);
  return cookie.split(';')[0]!;
}

describe('web security', () => {
  it('sends strict security headers', async () => {
    const { app } = await setup();
    const r = await request(app).get('/healthz');
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('requires a session for the API', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/tree')).status).toBe(401);
    expect((await request(app).get('/api/note?path=30-A.md')).status).toBe(401);
  });

  it('logs in with the MCP account (password + TOTP), refuses replay and bad credentials', async () => {
    const { app, totp } = await setup();
    const bad = await request(app).post('/api/login').set('x-aisidian', '1').send({ password: 'faux', totp: totp!.generate() });
    expect(bad.status).toBe(401);
    const cookie = await login(app, totp!);
    expect((await request(app).get('/api/tree').set('cookie', cookie)).status).toBe(200);
    const replay = await request(app).post('/api/login').set('x-aisidian', '1').send({ password: PW, totp: totp!.generate() });
    expect(replay.status).toBe(401);
    await request(app).post('/api/logout').set('x-aisidian', '1').set('cookie', cookie).send({});
    expect((await request(app).get('/api/tree').set('cookie', cookie)).status).toBe(401);
  });

  it('explains when no account exists yet', async () => {
    const { app } = await setup(false);
    const r = await request(app).post('/api/login').set('x-aisidian', '1').send({ password: 'x', totp: '123456' });
    expect(r.status).toBe(503);
  });

  it('blocks CSRF: missing header, foreign origin, non-JSON', async () => {
    const { app, totp } = await setup();
    const cookie = await login(app, totp!);
    expect((await request(app).post('/api/note').set('cookie', cookie).send({ title: 'X' })).status).toBe(403);
    expect((await request(app).post('/api/note').set('cookie', cookie).set('x-aisidian', '1').set('origin', 'https://evil.example').send({ title: 'X' })).status).toBe(403);
    expect((await request(app).post('/api/note').set('cookie', cookie).set('x-aisidian', '1').type('form').send('title=X')).status).toBe(415);
  });
});

describe('web vault API', () => {
  it('reads a note with links and backlinks', async () => {
    const { app, totp } = await setup();
    const cookie = await login(app, totp!);
    const a = await request(app).get('/api/note?path=30-A.md').set('cookie', cookie);
    expect(a.body.links).toEqual([{ target: 'B', path: '00-Inbox/B.md' }]);
    const b = await request(app).get('/api/note?path=00-Inbox/B.md').set('cookie', cookie);
    expect(b.body.backlinks).toEqual([{ path: '30-A.md', title: '30-A' }]);
    const g = await request(app).get('/api/graph').set('cookie', cookie);
    expect(g.body.edges).toEqual([['30-A.md', '00-Inbox/B.md']]);
  });

  it('saves with optimistic concurrency, bumps updated and commits', async () => {
    const { app, totp, vault } = await setup();
    const cookie = await login(app, totp!);
    const a = await request(app).get('/api/note?path=30-A.md').set('cookie', cookie);
    const text = a.body.text.replace('Voir', 'Lire');
    const ok = await request(app).put('/api/note').set('cookie', cookie).set('x-aisidian', '1').send({ path: '30-A.md', text, expected_version: a.body.version });
    expect(ok.status).toBe(200);
    expect(ok.body.text).toContain('Lire [[B]]');
    expect(ok.body.text).not.toContain('updated: 2020-01-01');
    const stale = await request(app).put('/api/note').set('cookie', cookie).set('x-aisidian', '1').send({ path: '30-A.md', text: 'x', expected_version: a.body.version });
    expect(stale.status).toBe(409);
    expect(stale.body.version).toBe(ok.body.version);
    const log = execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' });
    expect(log).toContain('[web] save · 30-A.md');
  });

  it('has Obsidian rights (writes in 99-Système) but no delete and no escape', async () => {
    const { app, totp, vault } = await setup();
    const cookie = await login(app, totp!);
    const c = await request(app).post('/api/note').set('cookie', cookie).set('x-aisidian', '1').send({ title: 'Règle perso', folder: '99-Système' });
    expect(c.status).toBe(200);
    expect(c.body.path).toBe('99-Système/Règle perso.md');
    expect((await request(app).post('/api/note').set('cookie', cookie).set('x-aisidian', '1').send({ title: 'Règle perso', folder: '99-Système' })).status).toBe(409);
    expect((await request(app).delete('/api/note?path=30-A.md').set('cookie', cookie).set('x-aisidian', '1').send({})).status).toBe(404);
    for (const p of ['../etc/passwd', '.git/config', '/etc/passwd']) {
      expect((await request(app).get(`/api/note?path=${encodeURIComponent(p)}`).set('cookie', cookie)).status).toBe(400);
    }
    expect((await request(app).post('/api/note').set('cookie', cookie).set('x-aisidian', '1').send({ title: 'x', folder: '../..' })).status).toBe(400);
    expect(await readFile(join(vault, '30-A.md'), 'utf8')).toContain('# A');
  });

  it('imports into the inbox without overwriting', async () => {
    const { app, totp } = await setup();
    const cookie = await login(app, totp!);
    const r = await request(app).post('/api/import').set('cookie', cookie).set('x-aisidian', '1').send({ files: [{ name: 'B.md', text: 'nouveau' }, { name: 'C.md', text: 'c' }] });
    expect(r.body.paths).toEqual(['00-Inbox/B (2).md', '00-Inbox/C.md']);
  });
});
