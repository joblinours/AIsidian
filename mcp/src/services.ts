import { mkdir } from 'node:fs/promises';
import { AgentRuns } from './agent.js';
import { Account } from './auth/account.js';
import { AisidianOAuthProvider } from './auth/provider.js';
import type { Config } from './config.js';
import { Git } from './git.js';
import { Journal } from './journal.js';
import { Ops } from './ops.js';
import { Permissions } from './vault/permissions.js';
import { Vault } from './vault/vault.js';

/** Wires every service from a configuration. */
export async function createServices(cfg: Config, opts: { fetchImpl?: typeof fetch } = {}) {
  await mkdir(cfg.stateDir, { recursive: true });
  const vault = new Vault(cfg.vaultDir);
  const perms = await Permissions.load(cfg.permissionsFile);
  const git = new Git(cfg.vaultDir, { name: cfg.gitAuthorName, email: cfg.gitAuthorEmail });
  await git.init();
  const journal = new Journal(cfg.stateDir);
  const agent = new AgentRuns(cfg, git);
  const ops = new Ops(cfg, vault, perms, git, journal, agent);
  const account = new Account(cfg.stateDir);
  const provider = new AisidianOAuthProvider(cfg, opts.fetchImpl);
  return { cfg, vault, perms, git, journal, agent, ops, account, provider };
}
