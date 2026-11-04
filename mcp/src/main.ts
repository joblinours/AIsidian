import { createApp, createStatusApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './services.js';
import { log } from './util.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const s = await createServices(cfg);

  const token = await s.account.ensureSetupToken();
  if (token) {
    const url = new URL('/setup', cfg.publicUrl);
    url.searchParams.set('token', token);
    // Printed on purpose: the one-time token only exists in the container logs.
    console.log('='.repeat(72));
    console.log('AIsidian: aucun compte configuré. Ouvre ce lien pour créer le compte :');
    console.log(url.href);
    console.log('='.repeat(72));
  }

  createApp(s).listen(cfg.port, () => log('info', 'mcp listening', { port: cfg.port, public_url: cfg.publicUrl.href, agent_mode: cfg.agentMode }));
  createStatusApp(s).listen(cfg.statusPort, () => log('info', 'status listening', { port: cfg.statusPort }));

  if (cfg.hourlyCommit) {
    const tick = async () => {
      try {
        const sha = await s.ops.commitDeviceChanges();
        if (sha) log('info', 'hourly commit', { sha });
      } catch (e) {
        log('error', 'hourly commit failed', { error: (e as Error).message });
      }
    };
    void tick();
    let lastHour = new Date().getHours();
    setInterval(() => {
      const h = new Date().getHours();
      if (h !== lastHour) {
        lastHour = h;
        void tick();
      }
    }, 60_000).unref();
  }

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      log('info', 'shutting down', { signal: sig });
      process.exit(0);
    });
  }
}

main().catch((e) => {
  log('error', 'fatal', { error: (e as Error).stack ?? String(e) });
  process.exit(1);
});
