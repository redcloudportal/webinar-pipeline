/** Shared fetch with a timeout and a readable error. */
export async function api(url, opts = {}, label = "API") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 15000);
  let res;
  try {
    res = await fetch(url, { ...opts, signal: ctl.signal });
  } catch (err) {
    throw new Error(`${label} unreachable: ${err.name === "AbortError" ? "timed out" : err.message}`);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 400) }; }
  if (!res.ok) {
    const msg = body?.message || body?.detail || body?.error?.message || body?.raw || `HTTP ${res.status}`;
    const err = new Error(`${label} returned ${res.status}: ${String(msg).slice(0, 300)}`);
    /* Callers need to tell "gone" from "broken" — the WordPress connector
       recreates a page someone deleted, but must not swallow a 500. */
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const need = (...keys) => keys;
