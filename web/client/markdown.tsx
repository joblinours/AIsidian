import type { ComponentChildren } from 'preact';

/** Minimal frontmatter reader for display (the server owns the real YAML). */
export function splitFrontmatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (meta[listKey] as string[]).push(unquote(item[1] ?? ''));
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const val = (kv[2] ?? '').trim();
    if (val === '') {
      meta[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(val)) {
      meta[key] = val.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      listKey = null;
    } else {
      meta[key] = unquote(val);
      listKey = null;
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, '');
}

/** Wikilink target → note path, or null for a missing note. */
export type Resolver = (target: string) => string | null;

const INLINE = /(\[\[[^\]]+\]\]|`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|(?:^|(?<=\s))#[\p{L}\p{N}_\-/]+)/gu;

function inline(text: string, resolve: Resolver, open: (p: string) => void): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let k = 0;
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith('[[')) {
      const inner = part.slice(2, -2);
      const [targetRaw, alias] = inner.split('|');
      const target = (targetRaw ?? '').split('#')[0]!.trim();
      const label = alias ?? targetRaw ?? '';
      const path = resolve(target);
      out.push(path
        ? <button key={k++} type="button" class="wl" onClick={() => open(path)}>{label}</button>
        : <span key={k++} class="dead" title="Note inexistante">{label}</span>);
    } else if (part.startsWith('`') && part.length > 1) {
      out.push(<code key={k++} class="inl">{part.slice(1, -1)}</code>);
    } else if (part.startsWith('**')) {
      out.push(<strong key={k++}>{part.slice(2, -2)}</strong>);
    } else if (/^\[[^\]]+\]\(https?:/.test(part)) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)!;
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noopener noreferrer">{mm[1]}</a>);
    } else if (/^#[\p{L}\p{N}]/u.test(part)) {
      out.push(<span key={k++} class="chip">{part}</span>);
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * Renders Markdown as Preact elements (never innerHTML): note content can not
 * inject markup or scripts into the page.
 */
export function Markdown({ text, resolve, open }: { text: string; resolve: Resolver; open: (p: string) => void }) {
  const { meta, body } = splitFrontmatter(text);
  const blocks: ComponentChildren[] = [];
  const lines = body.split(/\r?\n/);
  let key = 0;
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const status = typeof meta.status === 'string' ? meta.status : '';
  const type = typeof meta.type === 'string' ? meta.type : '';
  if (status || type || tags.length) {
    blocks.push(
      <div key={key++} class="chips">
        {status && <span class={`chip meta st-${status}`}>{status}</span>}
        {type && <span class="chip meta">{type}</span>}
        {tags.map((t) => <span key={t} class="chip">#{t}</span>)}
      </div>,
    );
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^```/.test(l)) {
      const lang = l.slice(3).trim();
      const buf: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) buf.push(lines[i]!);
      blocks.push(<pre key={key++} class="scroll">{lang && <span class="lang">{lang}</span>}<code>{buf.join('\n')}</code></pre>);
      continue;
    }
    if (/^# /.test(l)) blocks.push(<h1 key={key++}>{inline(l.slice(2), resolve, open)}</h1>);
    else if (/^#{2,6} /.test(l)) blocks.push(<h2 key={key++}>{inline(l.replace(/^#+ /, ''), resolve, open)}</h2>);
    else if (/^\s*[-*] \[( |x|X)\] /.test(l)) {
      const done = /\[(x|X)\]/.test(l);
      blocks.push(<div key={key++} class="li"><input type="checkbox" checked={done} disabled aria-label={done ? 'fait' : 'à faire'} /><span>{inline(l.replace(/^\s*[-*] \[.\] /, ''), resolve, open)}</span></div>);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) blocks.push(<div key={key++} class="li"><span class="bul" aria-hidden="true" /><span>{inline(l.replace(/^\s*([-*]|\d+\.) /, ''), resolve, open)}</span></div>);
    else if (/^> ?/.test(l)) blocks.push(<blockquote key={key++}>{inline(l.replace(/^> ?/, ''), resolve, open)}</blockquote>);
    else if (/^(-{3,}|\*{3,})\s*$/.test(l)) blocks.push(<hr key={key++} />);
    else if (l.trim() !== '') blocks.push(<p key={key++}>{inline(l, resolve, open)}</p>);
  }
  return <>{blocks}</>;
}

export function wordCount(text: string): number {
  return splitFrontmatter(text).body.split(/\s+/).filter(Boolean).length;
}
