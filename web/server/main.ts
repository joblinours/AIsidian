import { mkdir } from 'node:fs/promises';
import { log } from '../../mcp/src/util.js';
import { createWebApp } from './app.js';
import { WebAuth } from './auth.js';
import { loadWebConfig } from './config.js';
import { VaultApi } from './vaultApi.js';

async function main(): Promise<void> {
  const cfg = loadWebConfig();
  await mkdir(cfg.stateDir, { recursive: true });
  const auth = new WebAuth(cfg);
  const api = new VaultApi(cfg);
  await api.init();
  if (!(await auth.account())) log('warn', 'no account yet: create it with the MCP /setup wizard', { account_file: cfg.accountFile });
  createWebApp({ cfg, auth, api }).listen(cfg.port, () =>
    log('info', 'web listening', { port: cfg.port, public_url: cfg.publicUrl.href }),
  );
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => process.exit(0));
}

main().catch((e) => {
  log('error', 'fatal', { error: (e as Error).stack ?? String(e) });
  process.exit(1);
});
