import express, { type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { readFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { mcpAuthRouter, createOAuthMetadata, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Account, LockedError, MIN_PASSWORD_LENGTH } from './auth/account.js';
import { messagePage, loginPage, setupPage } from './auth/pages.js';
import { AisidianOAuthProvider } from './auth/provider.js';
import { endpoints, type Config } from './config.js';
import type { Endpoint, Ops } from './ops.js';
import { buildServer } from './tools/server.js';
import { log } from './util.js';

export interface AppDeps {
  cfg: Config;
  ops: Ops;
  account: Account;
  provider: AisidianOAuthProvider;
}

const SECURITY_HEADERS = (res: Response) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
};

/** Client IP: Cloudflare's header when present, else Express' (trust proxy aware). */
function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  return (typeof cf === 'string' && cf) || req.ip || 'unknown';
}

export function createApp({ cfg, ops, account, provider }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  const ep = endpoints(cfg);

  app.get('/healthz', async (_req, res) => {
    const gitOk = await ops.git.isHealthy();
    res.status(gitOk ? 200 : 503).json({ status: gitOk ? 'ok' : 'degraded', git: gitOk });
  });

  // Authorization server metadata, extended with CIMD support.
  const asMetadata = {
    ...createOAuthMetadata({ provider, issuerUrl: cfg.publicUrl }),
    client_id_metadata_document_supported: true,
  };
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(asMetadata);
  });
  // Protected resource metadata for the agent endpoint (the SDK router only serves /mcp).
  app.get('/.well-known/oauth-protected-resource/mcp/agent', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ resource: ep.agent.href, authorization_servers: [asMetadata.issuer], resource_name: 'AIsidian (agent nocturne)' });
  });

  const keyGenerator = (req: Request) => clientIp(req);
  const limiterOpts = { standardHeaders: true, legacyHeaders: false, keyGenerator, validate: false } as const;

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: cfg.publicUrl,
      resourceServerUrl: ep.main,
      resourceName: 'AIsidian',
      authorizationOptions: { rateLimit: { windowMs: 15 * 60_000, max: 60, keyGenerator, validate: false } },
      tokenOptions: { rateLimit: { windowMs: 15 * 60_000, max: 100, keyGenerator, validate: false } },
      clientRegistrationOptions: { rateLimit: { windowMs: 60 * 60_000, max: 20, keyGenerator, validate: false } },
      revocationOptions: { rateLimit: { windowMs: 15 * 60_000, max: 50, keyGenerator, validate: false } },
    }),
  );

  // ------------------------------------------------------------ login
  const loginLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60_000, max: 20 });
  app.post('/oauth/login', loginLimiter, express.urlencoded({ extended: false, limit: '8kb' }), async (req, res) => {
    SECURITY_HEADERS(res);
    const { request_id, password, totp } = req.body as Record<string, string | undefined>;
    const pending = typeof request_id === 'string' ? provider.getPending(request_id) : undefined;
    if (!pending || typeof password !== 'string' || typeof totp !== 'string') {
      res.status(400).type('html').send(messagePage('Demande expirée', 'Relance la connexion depuis Claude.'));
      return;
    }
    const again = (error: string) =>
      res.status(401).type('html').send(
        loginPage({ requestId: request_id!, clientName: pending.client.client_name ?? pending.client.client_id, redirectHost: new URL(pending.params.redirectUri).host, error }),
      );
    try {
      if (!(await account.login(password, totp))) {
        log('warn', 'login failed', { ip: clientIp(req) });
        again('Mot de passe ou code incorrect.');
        return;
      }
    } catch (e) {
      if (e instanceof LockedError) {
        again(e.message);
        return;
      }
      throw e;
    }
    log('info', 'login ok', { ip: clientIp(req), client_id: pending.client.client_id, resource: pending.resource });
    res.redirect(302, provider.completeAuthorization(request_id!));
  });

  // ------------------------------------------------------------ first-run setup
  const setupLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60_000, max: 30 });
  app.get('/setup', setupLimiter, async (req, res) => {
    SECURITY_HEADERS(res);
    if (await account.isConfigured()) return void res.status(404).type('html').send(messagePage('Introuvable', 'Rien ici.'));
    const token = req.query.token;
    if (!account.checkSetupToken(token)) {
      return void res.status(403).type('html').send(messagePage('Jeton requis', 'Ouvre le lien affiché dans les logs du conteneur mcp.'));
    }
    const { secret, uri } = account.pendingSecret(token as string);
    const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 0 });
    res.type('html').send(setupPage({ token: token as string, secret, qrSvg, minLength: MIN_PASSWORD_LENGTH }));
  });
  app.post('/setup', setupLimiter, express.urlencoded({ extended: false, limit: '8kb' }), async (req, res) => {
    SECURITY_HEADERS(res);
    if (await account.isConfigured()) return void res.status(404).type('html').send(messagePage('Introuvable', 'Rien ici.'));
    const { token, password, confirm, totp } = req.body as Record<string, string | undefined>;
    if (!account.checkSetupToken(token)) return void res.status(403).type('html').send(messagePage('Jeton requis', 'Jeton invalide.'));
    const retry = async (error: string) => {
      const { secret, uri } = account.pendingSecret(token!);
      const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 0 });
      res.status(400).type('html').send(setupPage({ token: token!, secret, qrSvg, error, minLength: MIN_PASSWORD_LENGTH }));
    };
    if (!password || password !== confirm) return void (await retry('Les mots de passe ne correspondent pas.'));
    try {
      await account.completeSetup(token!, password, totp ?? '');
    } catch (e) {
      return void (await retry((e as Error).message));
    }
    log('info', 'account configured, setup disabled');
    res.type('html').send(messagePage('Compte créé', 'Tu peux maintenant ajouter le connecteur dans Claude. Cette page est désactivée.'));
  });

  // ------------------------------------------------------------ MCP endpoints
  const mcpHandler = (endpoint: Endpoint, resource: URL) => {
    const auth = requireBearerAuth({
      verifier: provider,
      expectedResource: resource,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    });
    return [
      auth,
      express.json({ limit: '4mb' }),
      async (req: Request, res: Response) => {
        const client = await provider.clientLabel(req.auth!.clientId);
        const server = buildServer(ops, { endpoint, client });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        try {
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        } catch (e) {
          log('error', 'mcp request failed', { error: (e as Error).message });
          if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
        }
      },
    ];
  };
  app.all('/mcp', ...mcpHandler('main', ep.main));
  app.all('/mcp/agent', ...mcpHandler('agent', ep.agent));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  return app;
}

/** LAN-only status server for Zabbix (never routed through the tunnel). */
export function createStatusApp({ cfg, ops, account }: Omit<AppDeps, 'provider'>): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', async (_req, res) => {
    res.json({ status: (await ops.git.isHealthy()) ? 'ok' : 'degraded' });
  });
  app.get('/status', async (_req, res) => {
    const [stats, commit, agent, configured] = await Promise.all([
      ops.vault.stats(),
      ops.git.lastCommit(),
      ops.agent.store.get(),
      account.isConfigured(),
    ]);
    let backup: unknown = null;
    if (cfg.backupStatusFile) {
      backup = await readFile(cfg.backupStatusFile, 'utf8').then(JSON.parse).catch(() => null);
    }
    const age = (iso: string | null | undefined) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 1000) : null);
    res.json({
      now: new Date().toISOString(),
      account_configured: configured,
      vault: { notes: stats.notes, bytes: stats.bytes, last_commit: commit, last_commit_age_s: age(commit?.date) },
      agent: {
        mode: cfg.agentMode,
        last_report_at: agent.lastReportAt,
        last_report_age_s: age(agent.lastReportAt),
        last_report_path: agent.lastReportPath,
        run_in_progress: agent.run !== null,
      },
      backup,
    });
  });
  return app;
}
