import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, Mutex } from '../util.js';

/**
 * Tiny JSON document store in the mcp-state volume. Single user, low volume:
 * each document is one file rewritten atomically.
 */
export class JsonStore<T extends object> {
  private data: T | null = null;
  private mutex = new Mutex();
  private path: string;

  constructor(dir: string, name: string, private initial: () => T) {
    this.path = join(dir, `${name}.json`);
  }

  async get(): Promise<T> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.path, 'utf8')) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.data = this.initial();
    }
    return this.data;
  }

  /** Read-modify-write under a lock, then persist. */
  async update<R>(fn: (d: T) => R | Promise<R>): Promise<R> {
    return this.mutex.run(async () => {
      const d = await this.get();
      const r = await fn(d);
      await atomicWrite(this.path, JSON.stringify(d, null, 2));
      return r;
    });
  }
}
