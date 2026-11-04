import YAML from 'yaml';

export type Frontmatter = Record<string, unknown>;

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
  hasFrontmatter: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseNote(text: string): ParsedNote {
  const m = FM_RE.exec(text);
  if (!m) return { frontmatter: {}, body: text, hasFrontmatter: false };
  let fm: unknown;
  try {
    fm = YAML.parse(m[1] ?? '');
  } catch {
    // Malformed frontmatter: treat the whole file as body, never lose content.
    return { frontmatter: {}, body: text, hasFrontmatter: false };
  }
  return {
    frontmatter: fm && typeof fm === 'object' && !Array.isArray(fm) ? (fm as Frontmatter) : {},
    body: text.slice(m[0].length),
    hasFrontmatter: true,
  };
}

/** Canonical key order from the specification; other keys follow. */
const ORDER = ['title', 'created', 'updated', 'type', 'source', 'source_ref', 'captured', 'capture_id', 'tags', 'status'];

export function serializeNote(fm: Frontmatter, body: string): string {
  const ordered: Frontmatter = {};
  for (const k of ORDER) if (k in fm && fm[k] !== undefined) ordered[k] = fm[k];
  for (const [k, v] of Object.entries(fm)) if (!(k in ordered) && v !== undefined) ordered[k] = v;
  if (Object.keys(ordered).length === 0) return body;
  const yaml = YAML.stringify(ordered, { lineWidth: 0 }).trimEnd();
  const b = body.startsWith('\n') ? body.slice(1) : body;
  return `---\n${yaml}\n---\n${b}`;
}

/** Tag normalization: flat, lowercase, words separated by hyphens. */
export function normalizeTag(tag: string): string {
  return tag
    .normalize('NFC')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}\-/]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function tagsOf(fm: Frontmatter): string[] {
  const t = fm.tags;
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string').map(normalizeTag).filter(Boolean);
  if (typeof t === 'string') return t.split(/[,\s]+/).map(normalizeTag).filter(Boolean);
  return [];
}

const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu;
const CODE_BLOCK = /```[\s\S]*?```|`[^`\n]*`/g;

export function inlineTags(body: string): string[] {
  const clean = body.replace(CODE_BLOCK, '');
  const out = new Set<string>();
  for (const m of clean.matchAll(INLINE_TAG)) {
    const t = normalizeTag(m[1] ?? '');
    if (t && !/^\d+$/.test(t)) out.add(t);
  }
  return [...out];
}

const WIKILINK = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Targets of [[wikilinks]] (without alias/heading), as written. */
export function wikiLinks(body: string): string[] {
  const clean = body.replace(CODE_BLOCK, '');
  const out = new Set<string>();
  for (const m of clean.matchAll(WIKILINK)) {
    const t = (m[1] ?? '').trim();
    if (t) out.add(t);
  }
  return [...out];
}
