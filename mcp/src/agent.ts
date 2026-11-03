import type { Config } from './config.js';
import type { Git } from './git.js';
import { JsonStore } from './state/store.js';

export interface AgentState {
  lastRunEndSha: string | null;
  lastRunEndAt: string | null;
  lastReportAt: string | null;
  lastReportPath: string | null;
  run: null | {
    id: string;
    startedAt: string;
    startSha: string | null;
    sinceSha: string | null;
    writes: number;
    simulated: number;
    skipped: number;
  };
}

export class AgentError extends Error {}

/**
 * Lifecycle of a nightly agent pass on the /mcp/agent endpoint:
 * get_changes_since starts a run (commit "before"), write_report ends it (commit "after").
 */
export class AgentRuns {
  readonly store: JsonStore<AgentState>;

  constructor(private cfg: Config, private git: Git) {
    this.store = new JsonStore<AgentState>(cfg.stateDir, 'agent', () => ({
      lastRunEndSha: null,
      lastRunEndAt: null,
      lastReportAt: null,
      lastReportPath: null,
      run: null,
    }));
  }

  private isStale(startedAt: string): boolean {
    return Date.now() - Date.parse(startedAt) > this.cfg.agentRunTimeoutMinutes * 60_000;
  }

  async active(): Promise<AgentState['run']> {
    const s = await this.store.get();
    if (s.run && this.isStale(s.run.startedAt)) return null;
    return s.run;
  }

  /** Starts a run if none is active; returns the run. */
  async start(): Promise<NonNullable<AgentState['run']>> {
    const current = await this.active();
    if (current) return current;
    const startSha = await this.git.commitAll('[agent] avant passage (modifications des appareils)').then(
      async (sha) => sha ?? (await this.git.head()),
    );
    return this.store.update((s) => {
      s.run = {
        id: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        startSha,
        sinceSha: s.lastRunEndSha,
        writes: 0,
        simulated: 0,
        skipped: 0,
      };
      return s.run;
    });
  }

  async requireRun(): Promise<NonNullable<AgentState['run']>> {
    const r = await this.active();
    if (!r) throw new AgentError("Aucun passage en cours : appelle d'abord get_changes_since.");
    return r;
  }

  /** Reserves one write slot; throws when the per-run limit is reached. */
  async consumeWrite(): Promise<{ used: number; max: number }> {
    await this.requireRun();
    return this.store.update((s) => {
      const run = s.run!;
      if (run.writes >= this.cfg.agentMaxWrites) {
        throw new AgentError(
          `Limite de ${this.cfg.agentMaxWrites} écritures atteinte pour ce passage : arrête les modifications et signale-le dans le rapport.`,
        );
      }
      run.writes++;
      return { used: run.writes, max: this.cfg.agentMaxWrites };
    });
  }

  async count(kind: 'simulated' | 'skipped'): Promise<void> {
    await this.store.update((s) => {
      if (s.run) s.run[kind]++;
    });
  }

  async finish(reportPath: string): Promise<{ endSha: string | null; run: AgentState['run'] }> {
    const endSha = (await this.git.commitAll('[agent] après passage')) ?? (await this.git.head());
    return this.store.update((s) => {
      const run = s.run;
      const now = new Date().toISOString();
      s.lastReportAt = now;
      s.lastReportPath = reportPath;
      s.lastRunEndSha = endSha;
      s.lastRunEndAt = now;
      s.run = null;
      return { endSha, run };
    });
  }
}
