/**
 * Obsidian-like editing commands on a <textarea>. Every change goes through
 * `insertText` (execCommand) so the browser's native undo/redo keeps working.
 */

function insert(ta: HTMLTextAreaElement, start: number, end: number, text: string, selStart?: number, selEnd?: number): void {
  ta.focus();
  ta.setSelectionRange(start, end);
  // execCommand keeps the undo stack (Ctrl+Z); setRangeText is the fallback.
  const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const a = selStart ?? start + text.length;
  ta.setSelectionRange(a, selEnd ?? a);
}

function lineRange(value: string, start: number, end: number): [number, number] {
  const ls = value.lastIndexOf('\n', start - 1) + 1;
  let le = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  if (le < 0) le = value.length;
  return [ls, le];
}

/** Ctrl+B / Ctrl+I / Ctrl+/ : wraps (or unwraps) the selection. */
export function toggleWrap(ta: HTMLTextAreaElement, mark: string, close = mark): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const before = value.slice(s - mark.length, s);
  const after = value.slice(e, e + close.length);
  if (before === mark && after === close) {
    insert(ta, s - mark.length, e + close.length, value.slice(s, e), s - mark.length, e - mark.length);
    return;
  }
  const sel = value.slice(s, e);
  insert(ta, s, e, mark + sel + close, s + mark.length, s + mark.length + sel.length);
}

/** Ctrl+K : Markdown link around the selection, cursor in the URL. */
export function insertLink(ta: HTMLTextAreaElement): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e);
  const text = `[${sel}]()`;
  const cursor = sel ? s + text.length - 1 : s + 1;
  insert(ta, s, e, text, cursor);
}

/** Applies a transformation to every selected line, keeping the selection on them. */
function mapLines(ta: HTMLTextAreaElement, fn: (line: string, i: number) => string): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const [ls, le] = lineRange(value, s, e);
  const lines = value.slice(ls, le).split('\n');
  const out = lines.map(fn).join('\n');
  const single = lines.length === 1 && s === e;
  const delta = out.length - (le - ls);
  if (single) insert(ta, ls, le, out, Math.max(ls, s + delta));
  else insert(ta, ls, le, out, ls, ls + out.length);
}

/** Ctrl+L : plain → "- [ ]" → "- [x]" → "- [ ]". */
export function toggleCheckbox(ta: HTMLTextAreaElement): void {
  mapLines(ta, (line) => {
    const m = /^(\s*)([-*+]|\d+\.) \[( |x|X)\] (.*)$/.exec(line);
    if (m) return `${m[1]}${m[2]} [${m[3] === ' ' ? 'x' : ' '}] ${m[4]}`;
    const li = /^(\s*)([-*+]|\d+\.) (.*)$/.exec(line);
    if (li) return `${li[1]}${li[2]} [ ] ${li[3]}`;
    const ws = /^(\s*)(.*)$/.exec(line)!;
    return `${ws[1]}- [ ] ${ws[2]}`;
  });
}

/** Tab / Ctrl+] and Shift+Tab / Ctrl+[ : indent or outdent the selected lines. */
export function indent(ta: HTMLTextAreaElement, out: boolean): void {
  mapLines(ta, (line) => (out ? line.replace(/^(\t| {1,4})/, '') : '\t' + line));
}

/** Ctrl+D : deletes the current line(s) (text editing, not a note). */
export function deleteLines(ta: HTMLTextAreaElement): void {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const [ls, le] = lineRange(value, s, e);
  const end = le < value.length ? le + 1 : le;
  const start = end === le && ls > 0 ? ls - 1 : ls;
  insert(ta, start, end, '', start);
}

/** Enter inside a list continues it (or ends it on an empty item), like Obsidian. Returns true if handled. */
export function smartEnter(ta: HTMLTextAreaElement): boolean {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (s !== e) return false;
  const ls = value.lastIndexOf('\n', s - 1) + 1;
  const line = value.slice(ls, s);
  const m = /^(\s*)([-*+]|(\d+)\.)( \[[ xX]\])? (.*)$/.exec(line);
  if (!m) return false;
  if (!m[5]!.trim() && value.slice(s, value.indexOf('\n', s) < 0 ? value.length : value.indexOf('\n', s)).trim() === '') {
    // empty item: end the list
    insert(ta, ls, s, m[1]!);
    return true;
  }
  const marker = m[3] ? `${Number(m[3]) + 1}.` : m[2]!;
  const box = m[4] ? ' [ ]' : '';
  insert(ta, s, e, `\n${m[1]}${marker}${box} `);
  return true;
}

/** "[[" auto-closes into "[[]]" with the cursor inside. Returns true if handled. */
export function autoPairBrackets(ta: HTMLTextAreaElement): boolean {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (s !== e || value[s - 1] !== '[' || value.slice(s, s + 2) === ']]') return false;
  insert(ta, s, e, '[]]', s + 1);
  return true;
}

/** Wikilink being typed at the cursor ("[[que|" → { query: "que", start }), or null. */
export function wikilinkAtCursor(ta: HTMLTextAreaElement): { query: string; start: number; end: number } | null {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (s !== e) return null;
  const ls = value.lastIndexOf('\n', s - 1) + 1;
  const open = value.lastIndexOf('[[', s);
  if (open < ls) return null;
  const between = value.slice(open + 2, s);
  if (between.includes(']]') || between.includes('|') || between.includes('#')) return null;
  const close = value.indexOf(']]', s);
  const nl = value.indexOf('\n', s);
  const end = close >= 0 && (nl < 0 || close < nl) && !value.slice(s, close).includes('[[') ? close + 2 : s;
  return { query: between, start: open, end };
}

/** Replaces the wikilink being typed by [[title]]. */
export function completeWikilink(ta: HTMLTextAreaElement, link: { start: number; end: number }, title: string): void {
  insert(ta, link.start, link.end, `[[${title}]]`);
}

/** Target of the [[link]] under the cursor (Alt+Enter: follow link), or null. */
export function linkUnderCursor(ta: HTMLTextAreaElement): string | null {
  const { selectionStart: s, value } = ta;
  const ls = value.lastIndexOf('\n', s - 1) + 1;
  let le = value.indexOf('\n', s);
  if (le < 0) le = value.length;
  const line = value.slice(ls, le);
  const col = s - ls;
  for (const m of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (m.index! <= col && col <= m.index! + m[0].length) return m[1]!.split('|')[0]!.split('#')[0]!.trim();
  }
  return null;
}

/** Subsequence fuzzy score (higher is better), or -1 when it does not match. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const t = text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx - (t.length - q.length) * 0.1;
  let score = 0, ti = 0, last = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    score += found === last + 1 ? 5 : 1;
    last = found;
    ti = found + 1;
  }
  return score - t.length * 0.01;
}
