import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { log } from '../../mcp/src/util.js';
import { LockedError, NoAccountError, type WebAuth } from './auth.js';
import type { WebConfig } from './config.js';
import { ApiError, type VaultApi } from './vaultApi.js';

export interface WebDeps {
  cfg: WebConfig;
  auth: WebAuth;
  api: VaultApi;
}

/** Strict CSP: only same-origin scripts, fonts and requests; no inline script. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Preact sets `style` attributes: inline styles are needed, inline scripts are not.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const CSRF_HEADER = 'x-aisidian';

function cookieName(cfg: WebConfig): string {
  return cfg.secureCookie ? '__Host-aisidian' : 'aisidian';
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  return (typeof cf === 'string' && cf) || req.ip || 'unknown';
}

export function createWebApp({ cfg, auth, api }: WebDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  const cookie = cookieName(cfg);

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (cfg.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.get('/healthz', async (_req, res) => {
    const ok = (await api.ready()) && (await api.git.isHealthy());
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded' });
  });

  // ------------------------------------------------------------ API guards
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // CSRF: SameSite=Strict cookie + custom header (needs a CORS preflight cross-site) + Origin check.
      if (req.get(CSRF_HEADER) !== '1') return void res.status(403).json({ error: 'Requête refusée (CSRF)' });
      const origin = req.get('origin');
      if (origin && origin !== cfg.publicUrl.origin) return void res.status(403).json({ error: 'Origine refusée' });
      if (!req.is('application/json')) return void res.status(415).json({ error: 'JSON attendu' });
    }
    next();
  });
  app.use('/api', express.json({ limit: '25mb' }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => clientIp(req), validate: false,
    message: { error: 'Trop de tentatives, réessaie plus tard.' },
  });

  app.post('/api/login', loginLimiter, async (req, res) => {
    const { password, totp } = (req.body ?? {}) as { password?: unknown; totp?: unknown };
    if (typeof password !== 'string' || typeof totp !== 'string') return void res.status(400).json({ error: 'Champs manquants' });
    try {
      const token = await auth.login(password, totp);
      if (!token) {
        log('warn', 'web login failed', { ip: clientIp(req) });
        return void res.status(401).json({ error: 'Mot de passe ou code incorrect.' });
      }
      log('info', 'web login ok', { ip: clientIp(req) });
      res.cookie(cookie, token, {
        httpOnly: true, secure: cfg.secureCookie, sameSite: 'strict', path: '/',
        maxAge: cfg.sessionMaxDays * 86_400_000,
      });
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof LockedError) return void res.status(429).json({ error: e.message });
      if (e instanceof NoAccountError) return void res.status(503).json({ error: e.message });
      throw e;
    }
  });

  app.get('/api/session', async (req, res) => {
    res.json({ authenticated: await auth.check(readCookie(req, cookie)) });
  });

  app.post('/api/logout', async (req, res) => {
    await auth.logout(readCookie(req, cookie));
    res.clearCookie(cookie, { path: '/', secure: cfg.secureCookie, httpOnly: true, sameSite: 'strict' });
    res.json({ ok: true });
  });

  // Everything below requires a valid session.
  app.use('/api', async (req, res, next) => {
    if (await auth.check(readCookie(req, cookie))) return next();
    res.status(401).json({ error: 'Session expirée' });
  });

  const h = (fn: (req: Request) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req).then((r) => res.json(r)).catch(next);
  };
  app.get('/api/tree', h(() => api.tree()));
  app.get('/api/note', h((req) => api.read(req.query.path)));
  app.put('/api/note', h((req) => api.save(req.body ?? {})));
  app.post('/api/note', h((req) => api.create(req.body ?? {})));
  app.post('/api/import', h((req) => api.importFiles(req.body ?? {})));
  app.get('/api/graph', h(() => api.graph()));
  app.get('/api/search', h((req) => api.search(req.query.q)));
  app.get('/api/status', h(() => api.status()));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // ------------------------------------------------------------ static UI
  app.use(express.static(cfg.staticDir, { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => {
    if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    if (/\/assets\//.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) return void res.status(err.status).json({ error: err.message, ...err.extra });
    if ((err as { type?: string }).type === 'entity.too.large') return void res.status(413).json({ error: 'Requête trop volumineuse' });
    if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'JSON invalide' });
    log('error', 'web request failed', { error: (err as Error).stack ?? String(err) });
    res.status(500).json({ error: 'Erreur interne' });
  });
  return app;
}
