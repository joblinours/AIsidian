import { readFile } from 'node:fs/promises';
import { totpCounter, verifyPassword, type StoredAccount } from '../../mcp/src/auth/account.js';
import { JsonStore } from '../../mcp/src/state/store.js';
import { randomToken, sha256 } from '../../mcp/src/util.js';
import type { WebConfig } from './config.js';

interface AuthDoc {
  failures: { count: number; lockedUntil: number };
  lastTotpCounter: number;
  sessions: Record<string, { createdAt: number; lastSeen: number }>;
}

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export class LockedError extends Error {}
export class NoAccountError extends Error {}

/**
 * Login with the single AIsidian account (argon2id password + TOTP) created
 * through the MCP setup wizard. The account file is read-only here; lockout,
 * TOTP replay counter and sessions live in the web state volume.
 */
export class WebAuth {
  readonly store: JsonStore<AuthDoc>;

  constructor(private cfg: WebConfig) {
    this.store = new JsonStore<AuthDoc>(cfg.stateDir, 'auth', () => ({
      failures: { count: 0, lockedUntil: 0 },
      lastTotpCounter: 0,
      sessions: {},
    }));
  }

  /** Read on every login so that a reset of the account is picked up. */
  async account(): Promise<StoredAccount | null> {
    try {
      const doc = JSON.parse(await readFile(this.cfg.accountFile, 'utf8')) as { account?: StoredAccount | null };
      return doc.account ?? null;
    } catch {
      return null;
    }
  }

  /** Returns a session token, or null on bad credentials. */
  async login(password: string, code: string): Promise<string | null> {
    const account = await this.account();
    if (!account) throw new NoAccountError('Aucun compte : crée-le avec l\'assistant /setup du serveur MCP.');
    const doc = await this.store.get();
    if (doc.failures.lockedUntil > Date.now()) throw new LockedError('Trop d\'échecs : connexion bloquée 15 minutes.');
    const passOk = await verifyPassword(account.passwordHash, password);
    const counter = totpCounter(account.totpSecret, code);
    const ok = passOk && counter !== null && counter > doc.lastTotpCounter;
    const token = ok ? randomToken(32) : null;
    await this.store.update((d) => {
      if (ok) {
        d.lastTotpCounter = counter!;
        d.failures = { count: 0, lockedUntil: 0 };
        const now = Date.now();
        this.purge(d, now);
        d.sessions[sha256(token!)] = { createdAt: now, lastSeen: now };
      } else {
        d.failures.count++;
        if (d.failures.count >= MAX_FAILURES) d.failures = { count: 0, lockedUntil: Date.now() + LOCK_MS };
      }
    });
    return token;
  }

  private purge(d: AuthDoc, now: number): void {
    for (const [k, s] of Object.entries(d.sessions)) if (!this.alive(s, now)) delete d.sessions[k];
  }

  private alive(s: { createdAt: number; lastSeen: number }, now: number): boolean {
    return now - s.lastSeen < this.cfg.sessionIdleHours * 3_600_000 && now - s.createdAt < this.cfg.sessionMaxDays * 86_400_000;
  }

  /** Validates a session token and refreshes its idle timer (at most once a minute). */
  async check(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const key = sha256(token);
    const now = Date.now();
    const s = (await this.store.get()).sessions[key];
    if (!s || !this.alive(s, now)) return false;
    if (now - s.lastSeen > 60_000) {
      await this.store.update((d) => {
        if (d.sessions[key]) d.sessions[key]!.lastSeen = now;
      });
    }
    return true;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const key = sha256(token);
    await this.store.update((d) => {
      delete d.sessions[key];
    });
  }
}
