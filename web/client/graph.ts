/** Deterministic force-directed layout in a 0–100 square (percent of the panel). */
export function layout(ids: string[], edges: [string, string][], previous: Record<string, [number, number]> = {}): Record<string, [number, number]> {
  const n = ids.length;
  if (n === 0) return {};
  const idx = new Map(ids.map((id, i) => [id, i]));
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967295;
  };
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  ids.forEach((id, i) => {
    const p = previous[id];
    x[i] = p ? p[0] : 15 + hash(id) * 70;
    y[i] = p ? p[1] : 15 + hash(id + '#') * 70;
  });
  const E = edges.map(([a, b]) => [idx.get(a), idx.get(b)]).filter((e): e is [number, number] => e[0] !== undefined && e[1] !== undefined);
  const k = Math.min(22, 90 / Math.sqrt(n));
  const deg = new Float64Array(n);
  for (const [a, b] of E) { deg[a]!++; deg[b]!++; }
  const iterations = n > 400 ? 60 : 200;
  for (let it = 0; it < iterations; it++) {
    const t = 4 * (1 - it / iterations) + 0.2;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i]! - x[j]!, ey = y[i]! - y[j]!;
        let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) { ex = 0.1; ey = 0.1; d2 = 0.02; }
        const f = (k * k) / d2;
        dx[i]! += ex * f; dy[i]! += ey * f; dx[j]! -= ex * f; dy[j]! -= ey * f;
      }
    }
    for (const [a, b] of E) {
      const ex = x[a]! - x[b]!, ey = y[a]! - y[b]!;
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = d / k;
      dx[a]! -= ex * f; dy[a]! -= ey * f; dx[b]! += ex * f; dy[b]! += ey * f;
    }
    for (let i = 0; i < n; i++) {
      // Gravity toward the centre: strong for isolated notes (they would drift away
      // and, once the layout is fitted to the panel, squeeze the linked clusters).
      const g = deg[i] ? 0.05 : 0.6;
      dx[i]! += (50 - x[i]!) * g; dy[i]! += (50 - y[i]!) * g;
      const d = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 1;
      x[i] = x[i]! + (dx[i]! / d) * Math.min(d, t);
      y[i] = y[i]! + (dy[i]! / d) * Math.min(d, t);
    }
  }
  // Linked notes fill the centre; isolated notes (no link at all) sit on a ring
  // around them, as in Obsidian. Without this, they push the clusters aside.
  const linked: number[] = [];
  const orphans: number[] = [];
  for (let i = 0; i < n; i++) (deg[i] ? linked : orphans).push(i);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of linked) {
    minX = Math.min(minX, x[i]!); maxX = Math.max(maxX, x[i]!);
    minY = Math.min(minY, y[i]!); maxY = Math.max(maxY, y[i]!);
  }
  const inner = orphans.length ? { x0: 28, x1: 72, y0: 28, y1: 70 } : { x0: 14, x1: 86, y0: 12, y1: 84 };
  const fit = (v: number, lo: number, hi: number, a: number, b: number) => (hi - lo < 1e-6 ? (a + b) / 2 : a + ((v - lo) / (hi - lo)) * (b - a));
  for (const i of linked) {
    x[i] = fit(x[i]!, minX, maxX, inner.x0, inner.x1);
    y[i] = fit(y[i]!, minY, maxY, inner.y0, inner.y1);
  }
  if (orphans.length) {
    const ring = linked.length > 0;
    orphans.sort((a, b) => (ids[a]! < ids[b]! ? -1 : 1));
    orphans.forEach((i, j) => {
      if (ring) {
        const a = (2 * Math.PI * j) / orphans.length - Math.PI / 2;
        x[i] = 50 + Math.cos(a) * 38;
        y[i] = 48 + Math.sin(a) * 36;
      } else {
        // only isolated notes: a loose grid
        const cols = Math.ceil(Math.sqrt(orphans.length * 1.4));
        const rows = Math.ceil(orphans.length / cols);
        x[i] = fit(j % cols, 0, Math.max(cols - 1, 1), 14, 86);
        y[i] = fit(Math.floor(j / cols), 0, Math.max(rows - 1, 1), 14, 84);
      }
    });
  }
  // Collision pass: keep nodes (and their labels) at least minD apart in panel space.
  const minD = Math.max(3, Math.min(9, 70 / Math.sqrt(n)));
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ex = x[j]! - x[i]!, ey = y[j]! - y[i]!;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d >= minD) continue;
        moved = true;
        const push = (minD - d) / 2;
        const ux = d > 1e-6 ? ex / d : Math.cos(i + j), uy = d > 1e-6 ? ey / d : Math.sin(i + j);
        x[i] = Math.min(90, Math.max(10, x[i]! - ux * push)); y[i] = Math.min(88, Math.max(10, y[i]! - uy * push));
        x[j] = Math.min(90, Math.max(10, x[j]! + ux * push)); y[j] = Math.min(88, Math.max(10, y[j]! + uy * push));
      }
    }
    if (!moved) break;
  }
  const out: Record<string, [number, number]> = {};
  ids.forEach((id, i) => (out[id] = [Math.round(x[i]! * 10) / 10, Math.round(y[i]! * 10) / 10]));
  return out;
}
