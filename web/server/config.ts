import { resolve } from 'node:path';

export interface WebConfig {
  publicUrl: URL;
  port: number;
  vaultDir: string;
  stateDir: string;
  accountFile: string;
  staticDir: string;
  inboxFolder: string;
  sessionIdleHours: number;
  sessionMaxDays: number;
  gitAuthorName: string;
  gitAuthorEmail: string;
  trustProxy: string | number | boolean;
  timezone: string;
  secureCookie: boolean;
}

function int(env: NodeJS.ProcessEnv, name: string, def: number): number {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function trustProxy(v: string | undefined): string | number | boolean {
  if (v === undefined || v === '') return 1;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  if (!env.WEB_PUBLIC_URL) throw new Error('WEB_PUBLIC_URL is required (e.g. https://vault.example.com)');
  const publicUrl = new URL(env.WEB_PUBLIC_URL);
  publicUrl.pathname = '/';
  return {
    publicUrl,
    port: int(env, 'PORT', 8090),
    vaultDir: resolve(env.VAULT_DIR ?? '/vault'),
    stateDir: resolve(env.STATE_DIR ?? '/state'),
    accountFile: resolve(env.ACCOUNT_FILE ?? '/mcp-state/account.json'),
    staticDir: resolve(env.STATIC_DIR ?? new URL('../../../public', import.meta.url).pathname),
    inboxFolder: env.INBOX_FOLDER ?? '00-Inbox',
    sessionIdleHours: int(env, 'SESSION_IDLE_HOURS', 12),
    sessionMaxDays: int(env, 'SESSION_MAX_DAYS', 7),
    gitAuthorName: env.GIT_AUTHOR_NAME ?? 'AIsidian',
    gitAuthorEmail: env.GIT_AUTHOR_EMAIL ?? 'aisidian@localhost',
    trustProxy: trustProxy(env.TRUST_PROXY),
    timezone: env.TZ || 'Europe/Paris',
    // __Host- cookies require Secure, which requires HTTPS outside localhost.
    secureCookie: publicUrl.protocol === 'https:',
  };
}
