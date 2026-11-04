import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '../src/config.js';
import { createServices } from '../src/services.js';

export async function setup(env: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aisidian-'));
  const vaultDir = join(root, 'vault');
  const stateDir = join(root, 'state');
  await mkdir(vaultDir, { recursive: true });
  for (const d of ['00-Inbox', '10-Projets', '20-Domaines/Pro', '20-Domaines/DFIR/Certif', '30-Connaissances', '40-Journal', '90-Archives', '99-Système']) {
    await mkdir(join(vaultDir, d), { recursive: true });
  }
  const cfg: Config = loadConfig({
    PUBLIC_URL: 'http://localhost:8080',
    VAULT_DIR: vaultDir,
    STATE_DIR: stateDir,
    TZ: 'Europe/Paris',
    HOURLY_COMMIT: 'false',
    ...env,
  });
  const s = await createServices(cfg);
  return { ...s, root, vaultDir, stateDir };
}

export async function seed(vaultDir: string, rel: string, text: string) {
  const p = join(vaultDir, rel);
  await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, text);
}
