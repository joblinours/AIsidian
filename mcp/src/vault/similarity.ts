import { fold } from '../util.js';

function trigrams(s: string): Set<string> {
  const t = `  ${fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Title similarity in [0,1] (trigram Jaccard, accent and case insensitive). */
export function titleSimilarity(a: string, b: string): number {
  if (fold(a).trim() === fold(b).trim()) return 1;
  return jaccard(trigrams(a), trigrams(b));
}

export function shingles(text: string, size = 5): Set<string> {
  const words = fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length > 2);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

/** Text overlap in [0,1]: share of the smaller note's shingles found in the other. */
export function textOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / small.size;
}
