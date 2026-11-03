import { resolve } from 'node:path';

export type AgentMode = 'simulation' | 'real';

export interface Config {
  publicUrl: URL;
  port: number;
  statusPort: number;
  vaultDir: string;
  stateDir: string;
  permissionsFile?: string;
  agentMode: AgentMode;
  agentMaxWrites: number;
  agentRunTimeoutMinutes: number;
  allowedRedirectUris: string[];
  cimdAllowedHosts: string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  gitAuthorName: string;
  gitAuthorEmail: string;
  hourlyCommit: boolean;
  proposalsNote: string;
  reportFolder: string;
  inboxFolder: string;
  backupStatusFile?: string;
  trustProxy: string | number | boolean;
  timezone: string;
}

function int(env: NodeJS.ProcessEnv, name: string, def: number): number {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function list(env: NodeJS.ProcessEnv, name: string, def: string[]): string[] {
  const v = env[name];
  if (!v) return def;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function trustProxy(v: string | undefined): string | number | boolean {
  if (v === undefined || v === '') return 1;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrlRaw = env.PUBLIC_URL;
  if (!publicUrlRaw) throw new Error('PUBLIC_URL is required (e.g. https://notes.example.com)');
  const publicUrl = new URL(publicUrlRaw);
  publicUrl.pathname = '/';
  const agentMode = (env.AGENT_MODE ?? 'simulation') as AgentMode;
  if (agentMode !== 'simulation' && agentMode !== 'real') {
    throw new Error('AGENT_MODE must be "simulation" or "real"');
  }
  return {
    publicUrl,
    port: int(env, 'PORT', 8080),
    statusPort: int(env, 'STATUS_PORT', 9101),
    vaultDir: resolve(env.VAULT_DIR ?? '/vault'),
    stateDir: resolve(env.STATE_DIR ?? '/state'),
    permissionsFile: env.PERMISSIONS_FILE || undefined,
    agentMode,
    agentMaxWrites: int(env, 'AGENT_MAX_WRITES', 50),
    agentRunTimeoutMinutes: int(env, 'AGENT_RUN_TIMEOUT_MINUTES', 240),
    allowedRedirectUris: list(env, 'ALLOWED_REDIRECT_URIS', [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
    ]),
    cimdAllowedHosts: list(env, 'CIMD_ALLOWED_HOSTS', ['claude.ai', 'claude.com']),
    accessTokenTtlSeconds: int(env, 'ACCESS_TOKEN_TTL_SECONDS', 3600),
    refreshTokenTtlSeconds: int(env, 'REFRESH_TOKEN_TTL_SECONDS', 60 * 60 * 24 * 60),
    gitAuthorName: env.GIT_AUTHOR_NAME ?? 'AIsidian',
    gitAuthorEmail: env.GIT_AUTHOR_EMAIL ?? 'aisidian@localhost',
    hourlyCommit: (env.HOURLY_COMMIT ?? 'true') !== 'false',
    proposalsNote: env.PROPOSALS_NOTE ?? '40-Journal/À valider.md',
    reportFolder: env.REPORT_FOLDER ?? '40-Journal',
    inboxFolder: env.INBOX_FOLDER ?? '00-Inbox',
    backupStatusFile: env.BACKUP_STATUS_FILE || undefined,
    trustProxy: trustProxy(env.TRUST_PROXY),
    timezone: env.TZ || 'Europe/Paris',
  };
}

/** Endpoint URLs derived from the public URL. */
export function endpoints(cfg: Config) {
  return {
    main: new URL('/mcp', cfg.publicUrl),
    agent: new URL('/mcp/agent', cfg.publicUrl),
  };
}
