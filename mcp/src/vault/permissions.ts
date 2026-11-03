import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

export type Access = 'ro' | 'rw';

export interface PermissionRule {
  path: string;
  access: Access;
}

export interface PermissionsConfig {
  default: Access;
  rules: PermissionRule[];
}

/** Defaults from the specification (section 5). */
export const DEFAULT_PERMISSIONS: PermissionsConfig = {
  default: 'rw',
  rules: [
    { path: '99-Système', access: 'ro' },
    { path: '20-Domaines/DFIR/Certif', access: 'ro' },
    { path: '20-Domaines/Pro', access: 'ro' },
  ],
};

function key(p: string): string {
  // Case-insensitive and NFC: Windows/macOS/iOS file systems may fold case,
  // so "20-domaines/pro" must not escape a read-only rule.
  return p.normalize('NFC').toLowerCase().replace(/\/+$/, '');
}

export class Permissions {
  private rules: { key: string; access: Access }[];
  constructor(private cfg: PermissionsConfig) {
    this.rules = cfg.rules
      .map((r) => ({ key: key(r.path), access: r.access }))
      .sort((a, b) => b.key.length - a.key.length);
  }

  static async load(file?: string): Promise<Permissions> {
    if (!file) return new Permissions(DEFAULT_PERMISSIONS);
    const raw = YAML.parse(await readFile(file, 'utf8')) as Partial<PermissionsConfig> | null;
    const def = raw?.default ?? 'rw';
    const rules = raw?.rules ?? [];
    for (const r of [{ path: '*', access: def }, ...rules]) {
      if (r.access !== 'ro' && r.access !== 'rw') throw new Error(`Invalid access "${r.access}" in ${file}`);
      if (typeof r.path !== 'string') throw new Error(`Invalid rule path in ${file}`);
    }
    return new Permissions({ default: def, rules });
  }

  /** Access for a normalized vault-relative path (file or folder). */
  accessFor(rel: string): Access {
    const k = key(rel);
    for (const r of this.rules) {
      if (k === r.key || k.startsWith(r.key + '/')) return r.access;
    }
    return this.cfg.default;
  }

  canWrite(rel: string): boolean {
    return this.accessFor(rel) === 'rw';
  }

  describe(): PermissionsConfig {
    return this.cfg;
  }
}
