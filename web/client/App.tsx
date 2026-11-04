import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, HttpError, setUnauthorizedHandler, type Graph, type Note, type SearchHit, type Tree } from './api';
import { layout } from './graph';
import { IChevron, IClose, IDownload, IEdit, IEye, IFile, IFolder, IGraph, IPlus, ISave, ISearch, IUpload } from './icons';
import { Markdown, wordCount } from './markdown';

type Panel = 'editor' | 'graph' | 'explorer';
type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

const WORKSPACES = [
  { id: 1, label: 'Tiling : éditeur, graphe et explorateur' },
  { id: 2, label: 'Éditeur seul' },
  { id: 3, label: 'Graphe et explorateur' },
] as const;

const AUTOSAVE_MS = 1200;
const REFRESH_MS = 20_000;

function baseName(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/i, '');
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function clock(): string {
  const d = new Date();
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day} · ${time}`;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function App({ onLogout }: { onLogout: () => void }) {
  const [tree, setTree] = useState<Tree>({ folders: [], notes: [] });
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [tabs, setTabs] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [active, setActive] = useState<Panel>('editor');
  const [workspace, setWorkspace] = useState<1 | 2 | 3>(1);
  const [filter, setFilter] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [gfilter, setGfilter] = useState('');
  const [scope, setScope] = useState<'global' | 'local'>('global');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(clock());
  const toastTimer = useRef<number>();
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const flash = useCallback((text: string, error = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshLists = useCallback(async () => {
    const [t, g] = await Promise.all([api.tree(), api.graph()]);
    setTree(t);
    setGraph(g);
  }, []);

  const loadNote = useCallback(async (path: string) => {
    const n = await api.note(path);
    setNotes((s) => ({ ...s, [path]: n }));
    return n;
  }, []);

  const open = useCallback(
    async (path: string) => {
      setTabs((t) => (t.includes(path) ? t : [...t, path]));
      setCurrent(path);
      setActive('editor');
      if (workspace === 3) setWorkspace(1);
      try {
        await loadNote(path);
      } catch (e) {
        flash((e as Error).message, true);
      }
    },
    [loadNote, flash, workspace],
  );

  // initial load + periodic refresh (changes from devices, Claude, the agent)
  useEffect(() => {
    refreshLists().catch((e) => flash((e as Error).message, true));
    const t = window.setInterval(() => {
      refreshLists().catch(() => undefined);
      setNow(clock());
      const cur = currentRef.current;
      if (cur && draftsRef.current[cur] === undefined) loadNote(cur).catch(() => undefined);
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [refreshLists, loadNote, flash]);
  const currentRef = useRef(current);
  currentRef.current = current;

  // open the first inbox note (or the first note) on first load
  useEffect(() => {
    if (current || tabs.length || !tree.notes.length) return;
    const first = tree.notes.find((n) => n.folder === '00-Inbox' && !/^Index /.test(n.title)) ?? tree.notes[0];
    if (first) open(first.path);
  }, [tree, current, tabs.length, open]);

  // ---------------------------------------------------------------- saving
  const save = useCallback(
    async (path: string, force?: string) => {
      const text = draftsRef.current[path];
      const note = notesRef.current[path];
      if (text === undefined || !note) return;
      setSaveState((s) => ({ ...s, [path]: 'saving' }));
      try {
        const saved = await api.save(path, text, force ?? note.version);
        setNotes((s) => ({ ...s, [path]: saved }));
        setDrafts((d) => {
          if (d[path] !== text) return d; // typed meanwhile: keep the newer draft
          const { [path]: _, ...rest } = d;
          return rest;
        });
        setConflicts(({ [path]: _, ...rest }) => rest);
        setSaveState((s) => ({ ...s, [path]: draftsRef.current[path] !== text ? 'dirty' : 'saved' }));
        refreshLists().catch(() => undefined);
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) {
          setConflicts((c) => ({ ...c, [path]: String(e.body.version ?? '') }));
          setSaveState((s) => ({ ...s, [path]: 'conflict' }));
        } else {
          setSaveState((s) => ({ ...s, [path]: 'error' }));
          flash((e as Error).message, true);
        }
      }
    },
    [refreshLists, flash],
  );

  // autosave the current draft after a pause in typing
  useEffect(() => {
    if (!current || drafts[current] === undefined || saveState[current] === 'conflict') return;
    const path = current;
    const t = window.setTimeout(() => save(path), AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [current, drafts, saveState, save]);

  const reloadFromServer = async (path: string) => {
    setDrafts(({ [path]: _, ...rest }) => rest);
    setConflicts(({ [path]: _, ...rest }) => rest);
    setSaveState((s) => ({ ...s, [path]: 'saved' }));
    await loadNote(path);
  };

  const close = (path: string) => {
    if (drafts[path] !== undefined && saveState[path] !== 'conflict') save(path);
    setTabs((t) => {
      const i = t.indexOf(path);
      const next = t.filter((p) => p !== path);
      if (current === path) setCurrent(next[Math.min(i, next.length - 1)] ?? null);
      return next;
    });
  };

  // ---------------------------------------------------------------- search
  useEffect(() => {
    const q = filter.trim();
    if (!q) return setResults(null);
    const t = window.setTimeout(() => {
      api.search(q).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [filter]);

  // ---------------------------------------------------------------- import / export
  const importFiles = async (list: FileList | null | undefined) => {
    setDragOver(false);
    const files = Array.from(list ?? []).filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (!files.length) return flash('Aucun fichier .md reconnu', true);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      const r = await api.importFiles(payload);
      await refreshLists();
      flash(`${r.paths.length} note(s) importée(s) dans 00-Inbox`);
      if (r.paths[0]) open(r.paths[0]);
    } catch (e) {
      flash((e as Error).message, true);
    }
  };

  const selectedPaths = Object.keys(selected).filter((p) => selected[p]);
  const exportSelected = async () => {
    try {
      for (const p of selectedPaths) {
        const n = notes[p] ?? (await api.note(p));
        download(baseName(p) + '.md', drafts[p] ?? n.text);
      }
      flash(`${selectedPaths.length} note(s) exportée(s) en .md`);
    } catch (e) {
      flash((e as Error).message, true);
    }
  };

  // ---------------------------------------------------------------- derived data
  const cur = current ? notes[current] : undefined;
  const text = current ? drafts[current] ?? cur?.text ?? '' : '';

  const byBase = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of tree.notes) {
      const k = baseName(n.path).toLowerCase();
      if (!m.has(k)) m.set(k, n.path);
    }
    return m;
  }, [tree]);
  const resolve = useCallback(
    (target: string) => {
      const t = target.replace(/\.md$/i, '').toLowerCase();
      if (t.includes('/')) return tree.notes.find((n) => n.path.toLowerCase().replace(/\.md$/, '').endsWith(t))?.path ?? null;
      return byBase.get(t) ?? null;
    },
    [byBase, tree],
  );

  // Templates (99-Système/Templates, titles like {{title}}) are not knowledge: keep them out of the graph.
  const graphNodes = useMemo(() => graph.nodes.filter((n) => !/\{\{/.test(n.title) && !/\/Templates\//.test(n.path)), [graph]);
  const globalPositions = useMemo(() => layout(graphNodes.map((n) => n.path), graph.edges), [graphNodes, graph.edges]);
  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    for (const [a, b] of graph.edges) {
      d[a] = (d[a] ?? 0) + 1;
      d[b] = (d[b] ?? 0) + 1;
    }
    return d;
  }, [graph]);
  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (current) for (const [a, b] of graph.edges) {
      if (a === current) s.add(b);
      if (b === current) s.add(a);
    }
    return s;
  }, [graph, current]);
  const visible = graphNodes.filter((n) => scope === 'global' || !current || n.path === current || neighbors.has(n.path));
  const visibleSet = new Set(visible.map((n) => n.path));
  // The local graph gets its own layout over the whole panel.
  const localKey = scope === 'local' ? visible.map((n) => n.path).join('\0') : '';
  const localPositions = useMemo(
    () => (scope === 'local' ? layout(visible.map((n) => n.path), graph.edges.filter(([a, b]) => visibleSet.has(a) && visibleSet.has(b))) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localKey, graph.edges],
  );
  const positions = scope === 'local' ? localPositions : globalPositions;
  const gq = gfilter.trim().toLowerCase();
  let edgesD = '';
  let activeD = '';
  let edgeCount = 0;
  for (const [a, b] of graph.edges) {
    if (!visibleSet.has(a) || !visibleSet.has(b)) continue;
    const pa = positions[a], pb = positions[b];
    if (!pa || !pb) continue;
    const d = `M${pa[0]} ${pa[1]} L${pb[0]} ${pb[1]} `;
    edgeCount++;
    if (current && (a === current || b === current)) activeD += d;
    else edgesD += d;
  }
  const manyNodes = visible.length > 12;

  // explorer rows
  type Row =
    | { kind: 'folder'; path: string; label: string; depth: number; open: boolean; count: number }
    | { kind: 'note'; path: string; label: string; depth: number; hint: string };
  const rows: Row[] = [];
  if (results) {
    for (const r of results) rows.push({ kind: 'note', path: r.path, label: r.title, depth: 0, hint: folderOf(r.path) });
  } else {
    const folders = tree.folders;
    const notesIn = (f: string) => tree.notes.filter((n) => n.folder === f).sort((a, b) => a.title.localeCompare(b.title));
    const count = (f: string) => tree.notes.filter((n) => n.folder === f || n.folder.startsWith(f + '/')).length;
    const walk = (parent: string, depth: number) => {
      for (const f of folders.filter((x) => folderOf(x) === parent)) {
        const isOpen = !collapsed[f];
        rows.push({ kind: 'folder', path: f, label: f.split('/').pop()!, depth, open: isOpen, count: count(f) });
        if (isOpen) {
          walk(f, depth + 1);
          for (const n of notesIn(f)) rows.push({ kind: 'note', path: n.path, label: n.title, depth: depth + 1, hint: '' });
        }
      }
    };
    walk('', 0);
    for (const n of notesIn('')) rows.push({ kind: 'note', path: n.path, label: n.title, depth: 0, hint: '' });
  }

  const status = current ? saveState[current] ?? 'saved' : 'saved';
  const statusLabel: Record<SaveState, string> = { saved: 'enregistré', dirty: 'modifié', saving: 'enregistrement…', conflict: 'conflit', error: 'erreur' };
  const statusColor: Record<SaveState, string> = { saved: 'var(--green)', dirty: 'var(--yellow)', saving: 'var(--blue)', conflict: 'var(--red)', error: 'var(--red)' };
  const titles: Record<Panel, string> = {
    editor: `aisidian — ${cur ? baseName(cur.path) + '.md' : 'aucune note'}${mode === 'edit' ? '  [édition]' : ''}`,
    graph: `aisidian — graphe ${scope}`,
    explorer: 'aisidian — explorateur du vault',
  };
  const showEditor = workspace !== 3;
  const showSide = workspace !== 2;

  useEffect(() => {
    document.title = cur ? `${baseName(cur.path)} · AIsidian` : 'AIsidian';
  }, [cur]);

  // ---------------------------------------------------------------- render
  return (
    <div class="shell">
      <header class="bar">
        <nav class="ws" aria-label="Espaces de travail">
          {WORKSPACES.map((w) => (
            <button key={w.id} type="button" title={w.label} aria-label={`Espace ${w.id} : ${w.label}`} aria-pressed={workspace === w.id} onClick={() => setWorkspace(w.id)}>
              {w.id}
            </button>
          ))}
        </nav>
        <div class="bar-title">{titles[active]}</div>
        <div class="bar-right">
          <span class="wide"><span class="dot" aria-hidden="true" /> vault</span>
          <span>{tree.notes.length} notes</span>
          <span class="wide" style={{ color: 'var(--text)' }}>{now}</span>
          <button type="button" class="bar-btn hv" onClick={onLogout}>déconnexion</button>
        </div>
      </header>

      <main class={`tiles scroll${workspace !== 1 ? ' only' : ''}`}>
        {showEditor && (
          <div class={`win w-editor${active === 'editor' ? ' on' : ''}`} onMouseEnter={() => setActive('editor')} onFocusCapture={() => setActive('editor')}>
            <section aria-label="Note">
              <div class="tabs scroll">
                {tabs.map((p) => (
                  <div key={p} class={`tab${p === current ? ' on' : ''}`}>
                    <button type="button" onClick={() => open(p)}>
                      {baseName(p)}
                      {drafts[p] !== undefined ? ' •' : ''}
                    </button>
                    <button type="button" class="x hv" aria-label={`Fermer ${baseName(p)}`} onClick={() => close(p)}><IClose /></button>
                  </div>
                ))}
                <button type="button" class="hv" aria-label="Nouvelle note" onClick={() => setCreating(true)} style={{ flex: 'none', width: '38px', border: 'none', background: 'transparent', color: 'var(--sub0)', display: 'grid', placeItems: 'center' }}><IPlus /></button>
              </div>

              <div class="crumbs">
                <div class="path">{cur ? <>{cur.folder ? cur.folder.split('/').join(' / ') + ' / ' : ''}<b>{baseName(cur.path)}.md</b></> : ''}</div>
                {cur && mode === 'edit' && (
                  <button type="button" class="tbtn hv" onClick={() => current && save(current)} disabled={drafts[cur.path] === undefined || status === 'saving'} title="Enregistrer (Ctrl+S)"><ISave />Enregistrer</button>
                )}
                <div class="seg" role="group" aria-label="Mode">
                  <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}><IEdit />Édition</button>
                  <button type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}><IEye />Lecture</button>
                </div>
              </div>

              {current && status === 'conflict' && (
                <div class="banner" role="alert">
                  <span>Cette note a été modifiée ailleurs (appareil, Claude ou agent) depuis son ouverture.</span>
                  <button type="button" onClick={() => reloadFromServer(current)}>Recharger la version du vault</button>
                  <button type="button" onClick={() => save(current, conflicts[current])}>Écraser avec ma version</button>
                </div>
              )}

              {!cur && (
                <div class="empty">
                  <p style={{ margin: 0 }}>Aucune note ouverte</p>
                  <button type="button" class="hv" onClick={() => setCreating(true)}>Créer une note</button>
                </div>
              )}

              {cur && mode === 'read' && (
                <div class="reader scroll">
                  <article>
                    <Markdown text={text} resolve={resolve} open={open} />
                    {cur.backlinks.length > 0 && (
                      <div class="backlinks">
                        <p>Rétroliens · {cur.backlinks.length}</p>
                        <div>
                          {cur.backlinks.map((b) => (
                            <button key={b.path} type="button" class="hv" onClick={() => open(b.path)}>{b.title}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                </div>
              )}

              {cur && mode === 'edit' && (
                <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                  <label for="md-editor" class="sr">Contenu Markdown de la note</label>
                  <textarea
                    id="md-editor"
                    class="editor scroll"
                    value={text}
                    spellcheck={false}
                    placeholder="# Titre de la note"
                    onInput={(e) => {
                      const v = (e.target as HTMLTextAreaElement).value;
                      const p = cur.path;
                      setDrafts((d) => ({ ...d, [p]: v }));
                      setSaveState((s) => (s[p] === 'conflict' ? s : { ...s, [p]: 'dirty' }));
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                        e.preventDefault();
                        save(cur.path);
                      }
                    }}
                  />
                </div>
              )}

              <footer class="statusbar">
                <span>Markdown</span>
                <span>{cur ? wordCount(text) : 0} mots</span>
                <span>{cur ? cur.links.filter((l) => l.path).length : 0} liens sortants</span>
                <span>{cur ? cur.backlinks.length : 0} rétroliens</span>
                <span class="save-st" role="status"><span class="dot" style={{ background: statusColor[status], width: '7px', height: '7px' }} aria-hidden="true" />{statusLabel[status]}</span>
              </footer>
            </section>
          </div>
        )}

        {showSide && (
          <div class="col">
            <div class={`win w-graph${active === 'graph' ? ' on' : ''}`} onMouseEnter={() => setActive('graph')} onFocusCapture={() => setActive('graph')}>
              <section aria-label="Vue graphique">
                <div class="head">
                  <IGraph />
                  <h2>Graphe</h2>
                  <div class="seg" role="group" aria-label="Portée du graphe">
                    <button type="button" aria-pressed={scope === 'global'} onClick={() => setScope('global')}>Global</button>
                    <button type="button" aria-pressed={scope === 'local'} onClick={() => setScope('local')}>Local</button>
                  </div>
                  <label class="field" style={{ marginLeft: 'auto', height: '26px' }}>
                    <ISearch />
                    <span class="sr">Filtrer le graphe</span>
                    <input type="text" value={gfilter} onInput={(e) => setGfilter((e.target as HTMLInputElement).value)} placeholder="filtrer" style={{ width: '90px', fontSize: '11px' }} />
                  </label>
                </div>
                <div class="graph">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d={edgesD || 'M0 0'} fill="none" stroke="#45475a" stroke-width="1" vector-effect="non-scaling-stroke" />
                    <path d={activeD || 'M0 0'} fill="none" stroke="#cba6f7" stroke-width="1.6" stroke-opacity="0.85" vector-effect="non-scaling-stroke" />
                  </svg>
                  {visible.map((n) => {
                    const p = positions[n.path];
                    if (!p) return null;
                    const isCur = n.path === current;
                    const isNb = neighbors.has(n.path);
                    const size = 9 + Math.min(degree[n.path] ?? 0, 6) * 2.5;
                    const dim = gq && !n.title.toLowerCase().includes(gq);
                    // Many nodes: labels only for the current note, its neighbours, hubs and filter hits; the rest on hover.
                    const showLabel = !manyNodes || isCur || isNb || (degree[n.path] ?? 0) >= 2 || (gq && !dim);
                    return (
                      <button
                        key={n.path}
                        type="button"
                        class="gnode"
                        aria-label={`Ouvrir ${n.title}`}
                        title={n.title}
                        onClick={() => open(n.path)}
                        style={{ left: `${p[0]}%`, top: `${p[1]}%`, transform: `translate(-50%, -${Math.round(size / 2)}px)`, opacity: dim ? 0.25 : 1 }}
                      >
                        <span class="gdot" style={{ width: `${size}px`, height: `${size}px`, background: isCur ? 'var(--mauve)' : isNb ? 'var(--blue)' : 'var(--o1)', boxShadow: isCur ? '0 0 0 4px rgba(203,166,247,0.25)' : 'none' }} />
                        {<span class={`lbl${showLabel ? '' : ' hide'}`} style={{ color: isCur ? 'var(--text)' : isNb ? 'var(--sub1)' : 'var(--sub0)', fontWeight: isCur ? 600 : 400 }}>{n.title}</span>}
                      </button>
                    );
                  })}
                </div>
                <div class="statusbar" style={{ height: '26px' }}>
                  <span>{visible.length} nœuds · {edgeCount} liens</span>
                  <span style={{ marginLeft: 'auto' }}>clic sur un nœud → ouvrir</span>
                </div>
              </section>
            </div>

            <div class={`win w-explorer${active === 'explorer' ? ' on' : ''}`} onMouseEnter={() => setActive('explorer')} onFocusCapture={() => setActive('explorer')}>
              <section aria-label="Explorateur du vault">
                <div class="head" style={{ flexWrap: 'wrap', gap: '8px' }}>
                  <IFolder size={15} />
                  <h2>Vault</h2>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                    <button type="button" class="ibtn hv" aria-label="Nouvelle note" onClick={() => setCreating(true)}><IPlus size={14} /></button>
                    <label class="tbtn hv" style={{ cursor: 'pointer' }}>
                      <IUpload />Importer
                      <input type="file" multiple accept=".md,.markdown,.txt" onChange={(e) => { const el = e.target as HTMLInputElement; importFiles(el.files); el.value = ''; }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                    </label>
                    <button type="button" class="tbtn hv" onClick={exportSelected} disabled={!selectedPaths.length}><IDownload />Exporter{selectedPaths.length ? ` (${selectedPaths.length})` : ''}</button>
                  </div>
                </div>
                <div style={{ flex: 'none', padding: '8px 10px 4px' }}>
                  <label class="field" style={{ height: '30px' }}>
                    <ISearch />
                    <span class="sr">Rechercher dans le vault</span>
                    <input type="text" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} placeholder="rechercher une note…" />
                  </label>
                </div>
                <div class="rows scroll">
                  {rows.map((r) =>
                    r.kind === 'folder' ? (
                      <button key={'f:' + r.path} type="button" class="frow hv" aria-expanded={r.open} onClick={() => setCollapsed((c) => ({ ...c, [r.path]: !c[r.path] }))} style={{ paddingLeft: `${8 + r.depth * 14}px` }}>
                        <span class="chev" style={{ transform: `rotate(${r.open ? 90 : 0}deg)` }}><IChevron /></span>
                        <IFolder />
                        <span class="lbl">{r.label}</span>
                        <span class="cnt">{r.count}</span>
                      </button>
                    ) : (
                      <div key={'n:' + r.path} class={`nline${r.path === current ? ' on' : ''}`} style={{ paddingLeft: `${4 + r.depth * 14}px` }}>
                        <input type="checkbox" checked={!!selected[r.path]} onChange={() => setSelected((s) => ({ ...s, [r.path]: !s[r.path] }))} aria-label={`Sélectionner ${r.label} pour l’export`} />
                        <button type="button" class="nrow hv" onClick={() => open(r.path)}>
                          <IFile />
                          <span class="lbl">{r.label}</span>
                          {r.hint && <span class="hint">{r.hint}</span>}
                        </button>
                      </div>
                    ),
                  )}
                  {results && results.length === 0 && <p style={{ padding: '8px', color: 'var(--sub0)', margin: 0 }}>Aucun résultat</p>}
                </div>
                <div
                  class={`drop${dragOver ? ' over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); importFiles(e.dataTransfer?.files); }}
                >
                  Glisse des fichiers .md ici pour les importer dans 00-Inbox
                </div>
                <div class="statusbar" role="status">
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: toast ? (toast.error ? 'var(--red)' : 'var(--green)') : undefined }}>
                    {toast?.text ?? (selectedPaths.length ? `${selectedPaths.length} note(s) sélectionnée(s) pour l’export` : `${tree.notes.length} notes · ${tree.folders.length} dossiers`)}
                  </span>
                  {selectedPaths.length > 0 && <button type="button" class="linkbtn" onClick={() => setSelected({})}>désélectionner</button>}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {creating && (
        <NewNoteDialog
          folders={tree.folders}
          onCancel={() => setCreating(false)}
          onCreate={async (title, folder) => {
            const n = await api.create(title, folder);
            setCreating(false);
            setNotes((s) => ({ ...s, [n.path]: n }));
            await refreshLists();
            setMode('edit');
            open(n.path);
          }}
        />
      )}
    </div>
  );
}

function NewNoteDialog({ folders, onCancel, onCreate }: { folders: string[]; onCancel: () => void; onCreate: (title: string, folder: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(folders.includes('00-Inbox') ? '00-Inbox' : folders[0] ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="nn-title">
      <div class="card">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await onCreate(title, folder);
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <h1 id="nn-title">Nouvelle note</h1>
          <label>Titre<input autoFocus required value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Docker Compose - réseaux" /></label>
          <label>Dossier
            <select value={folder} onChange={(e) => setFolder((e.target as HTMLSelectElement).value)}>
              <option value="">(racine du vault)</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          {error && <p class="err" role="alert">{error}</p>}
          <div class="row">
            <button type="button" class="ghost hv" onClick={onCancel}>Annuler</button>
            <button type="submit" class="primary" disabled={busy || !title.trim()}>Créer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div class="overlay" style={{ background: 'var(--crust)' }}>
      <div class="card">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api.login(password, totp);
              onDone();
            } catch (err) {
              setError((err as Error).message);
              setTotp('');
            } finally {
              setBusy(false);
            }
          }}
        >
          <h1>AIsidian</h1>
          <p>Connexion au vault : même mot de passe et même code TOTP que le connecteur Claude.</p>
          <label>Mot de passe<input type="password" required autoFocus autocomplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></label>
          <label>Code TOTP<input inputMode="numeric" required autocomplete="one-time-code" pattern="[0-9 ]{6,7}" value={totp} onInput={(e) => setTotp((e.target as HTMLInputElement).value)} /></label>
          {error && <p class="err" role="alert">{error}</p>}
          <div class="row"><button type="submit" class="primary" disabled={busy}>Se connecter</button></div>
        </form>
      </div>
    </div>
  );
}

export function Root() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    api.session().then((s) => setAuthed(s.authenticated)).catch(() => setAuthed(false));
  }, []);
  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <App onLogout={() => api.logout().finally(() => setAuthed(false))} />;
}
