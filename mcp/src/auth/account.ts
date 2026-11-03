import { hash, verify } from '@node-rs/argon2';
import * as OTPAuth from 'otpauth';
import { timingSafeEqual } from 'node:crypto';
import { JsonStore } from '../state/store.js';
import { randomToken } from '../util.js';

interface AccountDoc {
  account: null | {
    passwordHash: string;
    totpSecret: string;
    createdAt: string;
    lastTotpCounter: number;
  };
  failures: { count: number; lockedUntil: number };
}

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;

function totpFor(secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({ issuer: 'AIsidian', label: 'AIsidian', algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}

export class LockedError extends Error {}

/**
 * The single user account: argon2id password + TOTP.
 * Until it exists, a one-time setup token (printed in the container logs)
 * guards the first-run wizard.
 */
export class Account {
  private store: JsonStore<AccountDoc>;
  private setupToken: string | null = null;
  private pendingTotp = new Map<string, string>();

  constructor(stateDir: string) {
    this.store = new JsonStore<AccountDoc>(stateDir, 'account', () => ({ account: null, failures: { count: 0, lockedUntil: 0 } }));
  }

  async isConfigured(): Promise<boolean> {
    return (await this.store.get()).account !== null;
  }

  /** Generates (once per process) the setup token if no account exists. */
  async ensureSetupToken(): Promise<string | null> {
    if (await this.isConfigured()) return null;
    if (!this.setupToken) this.setupToken = randomToken(24);
    return this.setupToken;
  }

  checkSetupToken(token: unknown): boolean {
    if (!this.setupToken || typeof token !== 'string') return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.setupToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** A TOTP secret proposed during setup, kept in memory until confirmed. */
  pendingSecret(setupToken: string): { secret: string; uri: string } {
    let secret = this.pendingTotp.get(setupToken);
    if (!secret) {
      secret = new OTPAuth.Secret({ size: 20 }).base32;
      this.pendingTotp.set(setupToken, secret);
    }
    return { secret, uri: totpFor(secret).toString() };
  }

  async completeSetup(setupToken: string, password: string, code: string): Promise<void> {
    if (!this.checkSetupToken(setupToken)) throw new Error('Jeton de configuration invalide.');
    if (await this.isConfigured()) throw new Error('Compte déjà configuré.');
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`);
    const secret = this.pendingTotp.get(setupToken);
    if (!secret) throw new Error('Secret TOTP introuvable : recharge la page.');
    const counter = this.totpCounter(secret, code);
    if (counter === null) throw new Error('Code TOTP incorrect.');
    const passwordHash = await hash(password, { algorithm: 2 /* argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await this.store.update((d) => {
      d.account = { passwordHash, totpSecret: secret, createdAt: new Date().toISOString(), lastTotpCounter: counter };
      d.failures = { count: 0, lockedUntil: 0 };
    });
    this.setupToken = null;
    this.pendingTotp.clear();
  }

  private totpCounter(secret: string, code: string): number | null {
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return null;
    const delta = totpFor(secret).validate({ token: clean, window: 1 });
    if (delta === null) return null;
    return Math.floor(Date.now() / 1000 / 30) + delta;
  }

  /** Verifies password + TOTP, with global lockout and TOTP replay protection. */
  async login(password: string, code: string): Promise<boolean> {
    const doc = await this.store.get();
    if (!doc.account) return false;
    if (doc.failures.lockedUntil > Date.now()) throw new LockedError('Trop d\'échecs : connexion bloquée 15 minutes.');
    const account = doc.account;
    const passOk = await verify(account.passwordHash, password).catch(() => false);
    const counter = this.totpCounter(account.totpSecret, code);
    const ok = passOk && counter !== null && counter > account.lastTotpCounter;
    await this.store.update((d) => {
      if (ok) {
        d.account!.lastTotpCounter = counter!;
        d.failures = { count: 0, lockedUntil: 0 };
      } else {
        d.failures.count++;
        if (d.failures.count >= MAX_FAILURES) {
          d.failures = { count: 0, lockedUntil: Date.now() + LOCK_MS };
        }
      }
    });
    return ok;
  }

  async reset(): Promise<void> {
    await this.store.update((d) => {
      d.account = null;
      d.failures = { count: 0, lockedUntil: 0 };
    });
  }
}
