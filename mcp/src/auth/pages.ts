function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const STYLE = `
:root{--bg:#f6f5f2;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#dcdad5;--accent:#5b3fd6;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececef;--muted:#9a9aa2;--card:#1e1e22;--line:#34343a;--accent:#a08cff;--err:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;max-width:420px;width:100%}
h1{font-size:1.3rem;margin:0 0 4px}p{color:var(--muted);margin:0 0 18px;font-size:.95rem}
label{display:block;font-size:.9rem;margin:14px 0 6px}input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg);font-size:1rem}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-size:1rem;cursor:pointer}
.err{color:var(--err);font-size:.9rem;margin-top:12px}.qr{display:flex;justify-content:center;margin:8px 0}.qr svg{width:200px;height:200px;background:#fff;padding:8px;border-radius:8px}
code{font-size:.85rem;word-break:break-all}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function loginPage(o: { requestId: string; clientName: string; redirectHost: string; error?: string }): string {
  return page(
    'AIsidian · Connexion',
    `<h1>AIsidian</h1><p>« ${esc(o.clientName)} » demande l'accès à ton vault.<br>Retour vers <strong>${esc(o.redirectHost)}</strong>.</p>
<form method="post" action="/oauth/login" autocomplete="off">
<input type="hidden" name="request_id" value="${esc(o.requestId)}">
<label for="p">Mot de passe</label><input id="p" name="password" type="password" required autocomplete="current-password" autofocus>
<label for="t">Code TOTP</label><input id="t" name="totp" inputmode="numeric" pattern="[0-9 ]{6,7}" required autocomplete="one-time-code">
<button type="submit">Autoriser</button>${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}</form>`,
  );
}

export function setupPage(o: { token: string; secret: string; qrSvg: string; error?: string; minLength: number }): string {
  return page(
    'AIsidian · Configuration',
    `<h1>Configuration initiale</h1><p>Crée le compte unique d'accès au serveur MCP. Cette page disparaît une fois le compte créé.</p>
<div class="qr">${o.qrSvg}</div><p>Scanne ce QR code dans ton application TOTP, ou saisis le secret :<br><code>${esc(o.secret)}</code></p>
<form method="post" action="/setup" autocomplete="off">
<input type="hidden" name="token" value="${esc(o.token)}">
<label for="p">Mot de passe (${o.minLength} caractères minimum)</label><input id="p" name="password" type="password" minlength="${o.minLength}" required autocomplete="new-password">
<label for="c">Confirmation</label><input id="c" name="confirm" type="password" minlength="${o.minLength}" required autocomplete="new-password">
<label for="t">Code TOTP actuel</label><input id="t" name="totp" inputmode="numeric" required autocomplete="one-time-code">
<button type="submit">Créer le compte</button>${o.error ? `<div class="err">${esc(o.error)}</div>` : ''}</form>`,
  );
}

export function messagePage(title: string, message: string): string {
  return page(`AIsidian · ${title}`, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`);
}
