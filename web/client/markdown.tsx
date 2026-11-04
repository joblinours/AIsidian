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

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`\s]*)/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const CALLOUT = /^\[!(\w+)\][+-]?\s*(.*)$/;

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  // split on unescaped pipes, outside inline code
  const out: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < r.length; i++) {
    const ch = r[i]!;
    if (ch === '`') code = !code;
    if (ch === '\\' && r[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
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
  const il = (t: string) => inline(t, resolve, open);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;

    // fenced code, also indented inside a list item; ``` or ~~~
    const f = FENCE.exec(l);
    if (f) {
      const indent = f[1]!.length;
      const fence = f[2]!;
      const lang = f[3] ?? '';
      const buf: string[] = [];
      for (i++; i < lines.length; i++) {
        const t = lines[i]!;
        if (t.trim().startsWith(fence[0]!.repeat(fence.length)) && t.trim().replace(/[`~]/g, '') === '') break;
        buf.push(t.slice(Math.min(indent, t.length - t.trimStart().length)));
      }
      blocks.push(<pre key={key++} class="scroll" style={{ marginLeft: indent ? `${Math.min(indent, 8) * 6}px` : undefined }}>{lang && <span class="lang">{lang}</span>}<code>{buf.join('\n')}</code></pre>);
      continue;
    }

    // table: header row + separator row
    if (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = cells(l);
      const align = cells(lines[i + 1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== ''; i++) rows.push(cells(lines[i]!));
      i--;
      blocks.push(
        <div key={key++} class="table-wrap scroll">
          <table>
            <thead><tr>{head.map((c, j) => <th key={j} style={{ textAlign: align[j] ?? 'left' }}>{il(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j} style={{ textAlign: align[j] ?? 'left' }}>{il(r[j] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    // block quote (consecutive lines merged), Obsidian callouts "> [!note] Titre"
    if (/^\s*>/.test(l)) {
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]!); i++) quote.push(lines[i]!.replace(/^\s*> ?/, ''));
      i--;
      const c = CALLOUT.exec(quote[0] ?? '');
      if (c) {
        const kind = c[1]!.toLowerCase();
        blocks.push(
          <div key={key++} class={`callout co-${kind}`}>
            <p class="co-title">{c[2] ? il(c[2]) : kind.charAt(0).toUpperCase() + kind.slice(1)}</p>
            {quote.slice(1).filter((q) => q.trim()).map((q, qi) => <p key={qi}>{il(q)}</p>)}
          </div>,
        );
      } else {
        blocks.push(<blockquote key={key++}>{quote.filter((q) => q.trim()).map((q, qi) => <p key={qi}>{il(q)}</p>)}</blockquote>);
      }
      continue;
    }

    const h = /^(#{1,6}) (.*)$/.exec(l);
    if (h) {
      const level = h[1]!.length;
      const content = il(h[2]!);
      blocks.push(level === 1 ? <h1 key={key++}>{content}</h1> : level === 2 ? <h2 key={key++}>{content}</h2> : <h3 key={key++} class={`h${level}`}>{content}</h3>);
      continue;
    }

    const li = /^(\s*)([-*+]|\d+\.) (\[( |x|X)\] )?(.*)$/.exec(l);
    if (li) {
      const depth = Math.min(6, li[1]!.replace(/\t/g, '    ').length >> 1);
      const ordered = /\d/.test(li[2]!);
      const pad = { paddingLeft: `${4 + depth * 12}px` };
      if (li[3]) {
        const done = li[4] !== ' ';
        blocks.push(<div key={key++} class={`li${done ? ' done' : ''}`} style={pad}><input type="checkbox" checked={done} disabled aria-label={done ? 'fait' : 'à faire'} /><span>{il(li[5]!)}</span></div>);
      } else {
        blocks.push(<div key={key++} class="li" style={pad}>{ordered ? <span class="num">{li[2]}</span> : <span class="bul" aria-hidden="true" />}<span>{il(li[5]!)}</span></div>);
      }
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) blocks.push(<hr key={key++} />);
    else if (l.trim() !== '') blocks.push(<p key={key++}>{il(l.trim())}</p>);
  }
  return <>{blocks}</>;
}

export function wordCount(text: string): number {
  return splitFrontmatter(text).body.split(/\s+/).filter(Boolean).length;
}
