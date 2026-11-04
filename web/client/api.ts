export interface TreeNote { path: string; title: string; folder: string }
export interface Tree { folders: string[]; notes: TreeNote[] }
export interface Note {
  path: string; title: string; folder: string; text: string; version: string;
  links: { target: string; path: string | null }[];
  backlinks: { path: string; title: string }[];
  modified: string;
}
export interface Graph { nodes: { path: string; title: string }[]; edges: [string, string][] }
export interface SearchHit { path: string; title: string; score: number; tags: string[]; snippet: string }

export class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown>) {
    super(message);
  }
}

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json', 'x-aisidian': '1' } : method === 'GET' ? {} : { 'x-aisidian': '1', 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && url !== '/api/login') onUnauthorized();
  if (!res.ok) throw new HttpError(res.status, String(data.error ?? `Erreur ${res.status}`), data);
  return data as T;
}

export const api = {
  session: () => call<{ authenticated: boolean }>('GET', '/api/session'),
  login: (password: string, totp: string) => call<{ ok: true }>('POST', '/api/login', { password, totp }),
  logout: () => call<{ ok: true }>('POST', '/api/logout'),
  tree: () => call<Tree>('GET', '/api/tree'),
  note: (path: string) => call<Note>('GET', `/api/note?path=${encodeURIComponent(path)}`),
  save: (path: string, text: string, expected_version: string) => call<Note>('PUT', '/api/note', { path, text, expected_version }),
  create: (title: string, folder: string) => call<Note>('POST', '/api/note', { title, folder }),
  importFiles: (files: { name: string; text: string }[]) => call<{ paths: string[] }>('POST', '/api/import', { files }),
  graph: () => call<Graph>('GET', '/api/graph'),
  search: (q: string) => call<{ results: SearchHit[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  status: () => call<{ notes: number; bytes: number; lastCommit: { date: string; subject: string } | null }>('GET', '/api/status'),
};
