import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface JournalEntry {
  client: string;
  endpoint: 'main' | 'agent';
  tool: string;
  note?: string;
  result: 'ok' | 'error' | 'denied' | 'simulated';
  detail?: string;
  commit?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Append-only access journal (JSON lines) in the state volume. */
export class Journal {
  private file: string;
  constructor(private dir: string) {
    this.file = join(dir, 'journal.jsonl');
  }

  async write(e: JournalEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const st = await stat(this.file).catch(() => null);
    if (st && st.size > MAX_BYTES) await rename(this.file, `${this.file}.1`).catch(() => undefined);
    await appendFile(this.file, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n');
  }
}
