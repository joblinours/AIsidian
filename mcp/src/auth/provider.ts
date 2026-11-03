import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { endpoints } from '../config.js';
import { JsonStore } from '../state/store.js';
import { randomToken, sha256, log } from '../util.js';
import { loginPage } from './pages.js';

interface Grant {
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt: number; // ms
  family: string;
}

interface OAuthDoc {
  clients: Record<string, OAuthClientInformationFull>;
  accessTokens: Record<string, Grant>;
  refreshTokens: Record<string, Grant & { used: boolean }>;
}

interface PendingAuthorization {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  resource: string;
  expiresAt: number;
}

interface AuthCode {
  clientId: string;
  challenge: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  expiresAt: number;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const CIMD_TTL_MS = 60 * 60 * 1000;

function stripSlash(u: string): string {
  return u.replace(/#.*$/, '').replace(/\/$/, '');
}

/**
 * Single-user OAuth 2.1 authorization server: DCR + CIMD clients, PKCE S256
 * (checked by the SDK), password+TOTP login, rotating refresh tokens with
 * reuse detection, tokens bound to one resource (/mcp or /mcp/agent).
 */
export class AisidianOAuthProvider implements OAuthServerProvider {
  readonly store: JsonStore<OAuthDoc>;
  private pending = new Map<string, PendingAuthorization>();
  private codes = new Map<string, AuthCode>();
  private cimdCache = new Map<string, { client: OAuthClientInformationFull; at: number }>();
  private resources: string[];

  constructor(private cfg: Config, private fetchImpl: typeof fetch = fetch) {
    this.store = new JsonStore<OAuthDoc>(cfg.stateDir, 'oauth', () => ({ clients: {}, accessTokens: {}, refreshTokens: {} }));
    const ep = endpoints(cfg);
    this.resources = [ep.main.href, ep.agent.href];
  }

  // ---------------------------------------------------------------- clients

  /** Redirect URIs accepted: configured HTTPS callbacks (exact) and loopback http on any port. */
  isAllowedRedirect(uri: string): boolean {
    if (this.cfg.allowedRedirectUris.includes(uri)) return true;
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      return false;
    }
    return u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !u.username && !u.password;
  }

  private validateRedirects(uris: unknown): string[] {
    if (!Array.isArray(uris) || uris.length === 0) throw new InvalidClientMetadataError('redirect_uris requis');
    for (const u of uris) {
      if (typeof u !== 'string' || !this.isAllowedRedirect(u)) {
        throw new InvalidClientMetadataError(`redirect_uri non autorisée : ${String(u)}`);
      }
    }
    return uris as string[];
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        if (/^https:\/\//.test(clientId)) return this.getCimdClient(clientId);
        return (await this.store.get()).clients[clientId];
      },
      registerClient: async (client) => {
        this.validateRedirects(client.redirect_uris);
        const doc = await this.store.get();
        if (Object.keys(doc.clients).length >= 200) throw new InvalidClientMetadataError('Trop de clients enregistrés');
        const full: OAuthClientInformationFull = {
          ...client,
          // Public clients only: PKCE protects the code, no secret to leak.
          token_endpoint_auth_method: 'none',
          client_secret: undefined,
          client_secret_expires_at: undefined,
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        await this.store.update((d) => {
          d.clients[full.client_id] = full;
        });
        log('info', 'oauth client registered', { client_id: full.client_id, client_name: full.client_name });
        return full;
      },
    };
  }

  /** Client ID Metadata Document: client_id is an HTTPS URL serving the client metadata. */
  private async getCimdClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const cached = this.cimdCache.get(clientId);
    if (cached && Date.now() - cached.at < CIMD_TTL_MS) return cached.client;
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      return undefined;
    }
    // SSRF guard: only fetch metadata documents from allowed hosts.
    if (!this.cfg.cimdAllowedHosts.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
      log('warn', 'cimd host not allowed', { client_id: clientId });
      return undefined;
    }
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(5000), redirect: 'error', headers: { accept: 'application/json' } });
      if (!res.ok) return undefined;
      const body = await res.text();
      if (body.length > 64 * 1024) return undefined;
      const meta = JSON.parse(body) as Partial<OAuthClientInformationFull>;
      if (meta.client_id !== clientId) return undefined;
      const redirect_uris = this.validateRedirects(meta.redirect_uris);
      const client: OAuthClientInformationFull = {
        ...meta,
        client_id: clientId,
        redirect_uris,
        token_endpoint_auth_method: 'none',
        client_secret: undefined,
      } as OAuthClientInformationFull;
      this.cimdCache.set(clientId, { client, at: Date.now() });
      return client;
    } catch (e) {
      log('warn', 'cimd fetch failed', { client_id: clientId, error: (e as Error).message });
      return undefined;
    }
  }

  // ---------------------------------------------------------------- authorize

  private resolveResource(resource?: URL): string {
    if (!resource) return this.resources[0]!;
    const r = stripSlash(resource.href);
    const match = this.resources.find((x) => stripSlash(x) === r);
    if (!match) throw new InvalidTargetError(`Ressource inconnue : ${resource.href}`);
    return match;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const resource = this.resolveResource(params.resource);
    this.gc();
    const requestId = randomToken(24);
    this.pending.set(requestId, { client, params, resource, expiresAt: Date.now() + PENDING_TTL_MS });
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.type('html').send(
      loginPage({
        requestId,
        clientName: client.client_name ?? client.client_id,
        redirectHost: new URL(params.redirectUri).host,
      }),
    );
  }

  getPending(requestId: string): PendingAuthorization | undefined {
    const p = this.pending.get(requestId);
    if (!p || p.expiresAt < Date.now()) return undefined;
    return p;
  }

  /** Called after a successful login: issues the code and returns the redirect URL. */
  completeAuthorization(requestId: string): string {
    const p = this.getPending(requestId);
    if (!p) throw new Error('Demande expirée');
    this.pending.delete(requestId);
    const code = randomToken(32);
    this.codes.set(sha256(code), {
      clientId: p.client.client_id,
      challenge: p.params.codeChallenge,
      redirectUri: p.params.redirectUri,
      resource: p.resource,
      scopes: p.params.scopes ?? [],
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    const url = new URL(p.params.redirectUri);
    url.searchParams.set('code', code);
    if (p.params.state !== undefined) url.searchParams.set('state', p.params.state);
    return url.href;
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expiresAt < now) this.pending.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
  }

  // ---------------------------------------------------------------- tokens

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const c = this.codes.get(sha256(authorizationCode));
    if (!c || c.clientId !== client.client_id || c.expiresAt < Date.now()) throw new InvalidGrantError('Code invalide');
    return c.challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const key = sha256(authorizationCode);
    const c = this.codes.get(key);
    this.codes.delete(key); // single use
    if (!c || c.clientId !== client.client_id || c.expiresAt < Date.now()) throw new InvalidGrantError('Code invalide ou expiré');
    if (redirectUri !== undefined && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri différente');
    if (resource && stripSlash(resource.href) !== stripSlash(c.resource)) throw new InvalidTargetError('Ressource différente');
    return this.issue(client.client_id, c.resource, c.scopes, randomUUID());
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const key = sha256(refreshToken);
    const grant = await this.store.update((d) => {
      const g = d.refreshTokens[key];
      if (!g || g.clientId !== client.client_id) return null;
      if (g.used || g.expiresAt < Date.now()) {
        if (g.used) {
          // Reuse of a rotated refresh token: revoke the whole family.
          log('warn', 'refresh token reuse detected, revoking family', { client_id: g.clientId });
          for (const [k, v] of Object.entries(d.refreshTokens)) if (v.family === g.family) delete d.refreshTokens[k];
          for (const [k, v] of Object.entries(d.accessTokens)) if (v.family === g.family) delete d.accessTokens[k];
        }
        return null;
      }
      g.used = true;
      return { ...g };
    });
    if (!grant) throw new InvalidGrantError('Refresh token invalide');
    if (resource && stripSlash(resource.href) !== stripSlash(grant.resource)) throw new InvalidTargetError('Ressource différente');
    const s = scopes?.length ? scopes.filter((x) => grant.scopes.includes(x)) : grant.scopes;
    return this.issue(client.client_id, grant.resource, s, grant.family);
  }

  private async issue(clientId: string, resource: string, scopes: string[], family: string): Promise<OAuthTokens> {
    const access = randomToken(32);
    const refresh = randomToken(32);
    const now = Date.now();
    await this.store.update((d) => {
      // purge expired entries; drop used refresh tokens after their expiry window
      for (const [k, v] of Object.entries(d.accessTokens)) if (v.expiresAt < now) delete d.accessTokens[k];
      for (const [k, v] of Object.entries(d.refreshTokens)) if (v.expiresAt < now) delete d.refreshTokens[k];
      d.accessTokens[sha256(access)] = { clientId, resource, scopes, family, expiresAt: now + this.cfg.accessTokenTtlSeconds * 1000 };
      d.refreshTokens[sha256(refresh)] = { clientId, resource, scopes, family, used: false, expiresAt: now + this.cfg.refreshTokenTtlSeconds * 1000 };
    });
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: this.cfg.accessTokenTtlSeconds,
      refresh_token: refresh,
      scope: scopes.length ? scopes.join(' ') : undefined,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const g = (await this.store.get()).accessTokens[sha256(token)];
    if (!g || g.expiresAt < Date.now()) throw new InvalidTokenError('Token invalide ou expiré');
    return {
      token,
      clientId: g.clientId,
      scopes: g.scopes,
      expiresAt: Math.floor(g.expiresAt / 1000),
      resource: new URL(g.resource),
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const key = sha256(request.token);
    await this.store.update((d) => {
      const g = d.accessTokens[key] ?? d.refreshTokens[key];
      if (!g || g.clientId !== client.client_id) return;
      for (const [k, v] of Object.entries(d.refreshTokens)) if (v.family === g.family) delete d.refreshTokens[k];
      for (const [k, v] of Object.entries(d.accessTokens)) if (v.family === g.family) delete d.accessTokens[k];
    });
  }

  async clientLabel(clientId: string): Promise<string> {
    const c = await this.clientsStore.getClient(clientId);
    const name = c?.client_name ?? 'client';
    return `${name} (${clientId.length > 40 ? clientId.slice(0, 40) + '…' : clientId.slice(0, 8)})`;
  }
}
