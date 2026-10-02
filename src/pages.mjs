/* The pipeline's few pages: sign in, choose a password, and the home page.
   Plain HTML, no scripts, no outside fonts or files — an internal tool that
   loads nothing from anywhere else. */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const layout = (title, body, { signedIn = false } = {}) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Red Cloud Webinar Pipeline</title>
<style>
  :root{--ink:#1d1d1f;--body:#3a3a3e;--muted:#7d7d82;--line:#e6e6e9;--frame:#f1f1f2;--red:#d7192a;--btn:#8d1e2b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--frame);color:var(--body);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
  header{background:var(--ink);color:#fff;border-top:4px solid var(--red)}
  header .in{max-width:880px;margin:0 auto;padding:16px 20px;display:flex;align-items:center;gap:12px}
  header b{letter-spacing:2px;font-size:13px}
  header span{color:#a7a7ab;font-size:13px;letter-spacing:1px}
  header nav{margin-left:auto;display:flex;gap:16px}
  header nav a{color:#c9c9cc;text-decoration:none;font-size:13px;letter-spacing:.5px}
  header nav a:hover{color:#fff}
  header form{margin-left:12px}
  main{max-width:880px;margin:28px auto;padding:0 20px}
  .card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:26px}
  .narrow{max-width:420px;margin:60px auto}
  h1{margin:0 0 6px;color:var(--ink);font-size:21px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;color:var(--red);margin:0 0 8px}
  .bar{width:40px;height:3px;background:var(--red);margin:10px 0 18px}
  label{display:block;font-size:13px;font-weight:600;color:var(--ink);margin:14px 0 6px}
  input{width:100%;padding:11px 12px;border:1px solid #cfcfd4;border-radius:4px;font:inherit}
  input:focus{outline:2px solid var(--btn);outline-offset:1px;border-color:var(--btn)}
  button{background:var(--btn);color:#fff;border:0;border-radius:4px;padding:11px 20px;font:inherit;font-weight:700;letter-spacing:1px;cursor:pointer;margin-top:18px}
  header button{background:transparent;border:1px solid #4a4a4f;margin:0;padding:6px 12px;font-size:12px}
  .err{background:#fbeaec;color:#8d1e2b;border-radius:4px;padding:10px 12px;margin:14px 0 0;font-size:14px}
  .ok{background:#eaf6ee;color:#1f6b3a;border-radius:4px;padding:10px 12px;margin:14px 0 0;font-size:14px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{text-align:left;padding:12px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:11px;letter-spacing:1.5px;color:var(--muted);font-weight:700}
  .pill{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--frame);color:var(--muted)}
  .pill.on{background:#eaf6ee;color:#1f6b3a}
  .note{color:var(--muted);font-size:13px;margin-top:18px}
  .keys td{padding:14px 8px}
  .keys form{display:flex;gap:8px;margin:0}
  .keys input{padding:8px 10px;font-size:14px}
  .keys button{margin:0;padding:8px 14px;font-size:13px;white-space:nowrap}
  .keys .clear{background:transparent;color:var(--muted);border:1px solid var(--line)}
  .grp{font-size:11px;letter-spacing:2px;color:var(--red);font-weight:700;padding-top:22px!important}
  .mono{font-family:ui-monospace,Menlo,monospace;color:var(--ink)}
</style></head><body>
<header><div class="in"><b>RED CLOUD</b><span>WEBINAR PIPELINE</span>
${signedIn ? `<nav><a href="/ops">Webinars</a><a href="/clips">Clips</a><a href="/pipeline">Pipeline</a><a href="/settings/keys">Keys</a></nav>
<form method="post" action="/logout"><button>Sign out</button></form>` : ""}</div></header>
<main>${body}</main></body></html>`;

export const loginPage = (error) => layout("Sign in", `
<div class="card narrow">
  <p class="eyebrow">INTERNAL</p><h1>Sign in</h1><div class="bar"></div>
  <form method="post" action="/login">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <button>SIGN IN</button>
  </form>
</div>`);

export const noPasswordPage = () => layout("Not set up", `
<div class="card narrow">
  <p class="eyebrow">INTERNAL</p><h1>No password yet</h1><div class="bar"></div>
  <p>The sign-in password hasn&rsquo;t been chosen. It is set with a one-time link generated on the server.</p>
</div>`);

export const setupPage = (token, { error, done } = {}) => layout("Choose a password", `
<div class="card narrow">
  <p class="eyebrow">ONE-TIME LINK</p><h1>Choose the password</h1><div class="bar"></div>
  ${done ? `<p class="ok">Password saved. This link no longer works.</p><p><a href="/login">Sign in &rarr;</a></p>` : `
  <form method="post" action="/setup">
    <input type="hidden" name="t" value="${esc(token)}">
    <label for="pw">New password</label>
    <input id="pw" name="password" type="password" autocomplete="new-password" required autofocus>
    <label for="pw2">Again</label>
    <input id="pw2" name="again" type="password" autocomplete="new-password" required>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <button>SAVE PASSWORD</button>
  </form>
  <p class="note">This link works once, and stops working when it expires.</p>`}
</div>`);

export const linkDeadPage = () => layout("Link expired", `
<div class="card narrow">
  <p class="eyebrow">ONE-TIME LINK</p><h1>This link has expired</h1><div class="bar"></div>
  <p>It has either been used already or is more than 24 hours old. Ask for a new one.</p>
</div>`);

export const homePage = (pieces) => layout("Home", `
<div class="card">
  <p class="eyebrow">WEBINAR PIPELINE</p><h1>What&rsquo;s connected</h1><div class="bar"></div>
  <table>
    <tr><th>PIECE</th><th>STATUS</th><th>WHAT IT DOES</th></tr>
    ${pieces.map((p) => `<tr><td><b style="color:#1d1d1f">${esc(p.name)}</b></td>
      <td><span class="pill${p.on ? " on" : ""}">${esc(p.status)}</span></td><td>${esc(p.what)}</td></tr>`).join("")}
  </table>
  <p class="note">Nothing here runs on its own. Each piece is switched on deliberately, one at a time.</p>
</div>`, { signedIn: true });

export const keysPage = (rows, { notice, error } = {}) => layout("Keys", `
<div class="card">
  <p class="eyebrow">SETTINGS</p><h1>Keys</h1><div class="bar"></div>
  <p>Paste a key here instead of anywhere else. It is stored on the server only and goes live at once. After saving, only the last four characters are ever shown.</p>
  ${notice ? `<p class="ok">${esc(notice)}</p>` : ""}${error ? `<p class="err">${esc(error)}</p>` : ""}
  <table class="keys">
    ${["Live", "Coming"].map((g) => `<tr><td colspan="3" class="grp">${g === "Live" ? "IN USE" : "FOR LATER"}</td></tr>` +
      rows.filter((r) => r.group === g).map((r) => `<tr>
        <td style="width:34%"><b style="color:#1d1d1f">${esc(r.label)}</b><br><span style="color:#7d7d82;font-size:13px">${esc(r.for)}</span></td>
        <td style="width:20%">${r.set ? `<span class="pill on">set</span> <span class="mono">${r.name === "MAIL_FROM" ? esc(r.tail) : "&middot;&middot;&middot;&middot;" + esc(r.tail)}</span><br><span style="color:#7d7d82;font-size:12px">from ${esc(r.source)}</span>` : `<span class="pill">not set</span>`}</td>
        <td><form method="post" action="/settings/keys"><input type="hidden" name="name" value="${esc(r.name)}">
          <input name="value" type="${r.name === "MAIL_FROM" ? "text" : "password"}" autocomplete="off" placeholder="${r.set ? "Paste a new value to replace it" : "Paste the value"}">
          <button name="do" value="save">Save</button>
          ${r.source === "Keys page" ? `<button name="do" value="clear" class="clear" formnovalidate>Clear</button>` : ""}
        </form></td></tr>`).join("")).join("")}
  </table>
</div>`, { signedIn: true });
