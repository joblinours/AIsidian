import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fuzzy } from './editing';

export interface PaletteItem {
  id: string;
  label: string;
  /** Right-hand hint: shortcut or folder. */
  hint?: string;
  run: () => void;
}

/**
 * Modal list with fuzzy filter: Obsidian's command palette (Ctrl+P) and quick
 * switcher (Ctrl+O). ↑/↓ to move, Enter to run, Escape to close.
 */
export function Palette({
  placeholder,
  items,
  onClose,
  extra,
}: {
  placeholder: string;
  items: PaletteItem[];
  onClose: () => void;
  /** Item added for a non-empty query (e.g. "Créer « … »"). */
  extra?: (query: string) => PaletteItem | null;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Preact does not apply autoFocus to elements mounted after page load.
  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => {
    const scored = items
      .map((it) => ({ it, score: Math.max(fuzzy(query, it.label), fuzzy(query, it.hint ?? '') - 50) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.it);
    const ex = query.trim() && extra ? extra(query.trim()) : null;
    return ex ? [...scored, ex] : scored;
  }, [items, query, extra]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <div class="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette" role="dialog" aria-modal="true" aria-label={placeholder}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={filtered[index] ? `pi-${index}` : undefined}
          placeholder={placeholder}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(filtered[index]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <ul id="palette-list" role="listbox" ref={listRef} class="scroll">
          {filtered.map((it, i) => (
            <li key={it.id} id={`pi-${i}`} role="option" aria-selected={i === index}>
              <button type="button" class={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onClick={() => run(it)}>
                <span class="pl">{it.label}</span>
                {it.hint && <span class="ph">{it.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li class="pe">Aucun résultat</li>}
        </ul>
      </div>
    </div>
  );
}
