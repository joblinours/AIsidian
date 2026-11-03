import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { createApp } from '../src/app.js';
import { setup } from './helpers.js';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function withAccount() {
  const s = await setup();
  const token = (await s.account.ensureSetupToken())!;
  const { secret } = s.account.pendingSecret(token);
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
  // previous period for setup, current period for login (replay protection)
  await s.account.completeSetup(token, 'correct horse battery', totp.generate({ timestamp: Date.now() - 30_000 }));
  const app = createApp(s);
  return { s, app, totp };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function authorize(app: ReturnType<typeof createApp>, totp: OTPAuth.TOTP, resource?: string, redirect = REDIRECT) {
  const reg = await request(app).post('/register').send({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' });
  expect(reg.status).toBe(201);
  const clientId = reg.body.client_id as string;
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st' });
  if (resource) q.set('resource', resource);
  const page = await request(app).get(`/authorize?${q}`);
  expect(page.status).toBe(200);
  const requestId = /name="request_id" value="([^"]+)"/.exec(page.text)![1]!;
  const bad = await request(app).post('/oauth/login').type('form').send({ request_id: requestId, password: 'wrong password!', totp: totp.generate() });
  expect(bad.status).toBe(401);
  const login = await request(app).post('/oauth/login').type('form').send({ request_id: requestId, password: 'correct horse battery', totp: totp.generate() });
  expect(login.status).toBe(302);
  const loc = new URL(login.headers.location!);
  expect(loc.searchParams.get('state')).toBe('st');
  const tok = await request(app).post('/token').type('form').send({
    grant_type: 'authorization_code', code: loc.searchParams.get('code')!, code_verifier: verifier, client_id: clientId, redirect_uri: redirect,
    ...(resource ? { resource } : {}),
  });
  expect(tok.status).toBe(200);
  return { clientId, tokens: tok.body as { access_token: string; refresh_token: string } };
}

const rpc = (method: string, params: object = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const MCP_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };

describe('OAuth + MCP', () => {
  it('T13: 401 with WWW-Authenticate resource_metadata without a token', async () => {
    const { app } = await withAccount();
    const r = await request(app).post('/mcp').set(MCP_HEADERS).send(rpc('tools/list'));
    expect(r.status).toBe(401);
    expect(r.headers['www-authenticate']).toMatch(/Bearer .*resource_metadata="http:\/\/localhost:8080\/.well-known\/oauth-protected-resource\/mcp"/);
    const prm = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(prm.body.authorization_servers).toEqual(['http://localhost:8080/']);
    const as = await request(app).get('/.well-known/oauth-authorization-server');
    expect(as.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.body.client_id_metadata_document_supported).toBe(true);
  });

  it('rejects unknown redirect URIs at registration', async () => {
    const { app } = await withAccount();
    const r = await request(app).post('/register').send({ redirect_uris: ['https://evil.example/cb'] });
    expect(r.status).toBe(400);
  });

  it('full flow: login + TOTP, PKCE, MCP call, refresh rotation and reuse detection', async () => {
    const { app, totp } = await withAccount();
    const { clientId, tokens } = await authorize(app, totp, undefined, 'http://127.0.0.1:53682/callback');
    const list = await request(app).post('/mcp').set(MCP_HEADERS).set('authorization', `Bearer ${tokens.access_token}`).send(rpc('tools/list'));
    expect(list.status).toBe(200);
    const names = (list.body.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('create_note');
    expect(names).not.toContain('delete_note');
    expect(names).not.toContain('get_changes_since');

    // A /mcp token is not valid on the agent endpoint.
    const agentTry = await request(app).post('/mcp/agent').set(MCP_HEADERS).set('authorization', `Bearer ${tokens.access_token}`).send(rpc('tools/list'));
    expect(agentTry.status).toBe(401);

    const r1 = await request(app).post('/token').type('form').send({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(r1.status).toBe(200);
    // Reusing the old refresh token revokes the family, including the new one.
    const reuse = await request(app).post('/token').type('form').send({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    expect(reuse.status).toBe(400);
    const r2 = await request(app).post('/token').type('form').send({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: clientId });
    expect(r2.status).toBe(400);
  });

  it('agent connector: token bound to /mcp/agent exposes agent tools', async () => {
    const { app, totp } = await withAccount();
    const { tokens } = await authorize(app, totp, 'http://localhost:8080/mcp/agent');
    const list = await request(app).post('/mcp/agent').set(MCP_HEADERS).set('authorization', `Bearer ${tokens.access_token}`).send(rpc('tools/list'));
    expect(list.status).toBe(200);
    const names = (list.body.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_changes_since', 'write_report', 'propose_action']));
    const main = await request(app).post('/mcp').set(MCP_HEADERS).set('authorization', `Bearer ${tokens.access_token}`).send(rpc('tools/list'));
    expect(main.status).toBe(401);
  });

  it('setup page needs the one-time token and disappears once configured', async () => {
    const s = await setup();
    const app = createApp(s);
    const token = (await s.account.ensureSetupToken())!;
    expect((await request(app).get('/setup')).status).toBe(403);
    expect((await request(app).get(`/setup?token=${token}`)).status).toBe(200);
    const { app: app2 } = await withAccount();
    expect((await request(app2).get('/setup')).status).toBe(404);
  });
});
