import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";

/* ── keys, pasted on the Keys page ─────────────────────────────
   API keys never travel through chat and nobody needs a terminal. A signed-in
   person pastes a key on /settings/keys; it is stored here, on the server only
   (/data/secrets.json, readable by the app alone), and goes live at once.
   Afterwards the page shows only "set" and the last four characters.

   Why this exists: Netlify never gives a secret back once saved (it returns a
   masked placeholder), so the keys could not be copied over from there.

   Values here take precedence over .env. Clearing one falls back to .env.
   ───────────────────────────────────────────────────────────── */

const FILE = `${process.env.DATA_DIR || "/data"}/secrets.json`;

/* What can be set, and what each is for. Only these names are accepted. */
export const KNOWN = [
  { name: "MAILCHIMP_API_KEY", label: "Mailchimp API key", for: "Creates the invite drafts. Ends in -us5.", group: "Live" },
  { name: "ANTHROPIC_API_KEY", label: "Anthropic API key", for: "Title suggestions and the company profile on the client form.", group: "Live" },
  { name: "BOX_CLIENT_SECRET", label: "Box client secret", for: "Files submissions into Box (the \"Red Cloud Webinar Filing\" app).", group: "Live" },
  { name: "RIVERSIDE_API_KEY", label: "Riverside API key", for: "Riverside → Settings → Team → API → Generate (once). Pending with Riverside.", group: "Coming" },
  { name: "RESEND_API_KEY", label: "Resend API key", for: "Sends the run-up emails and calendar invites. Off until set.", group: "Coming" },
  { name: "MAIL_FROM", label: "Send-from address", for: "The address those emails come from, e.g. webinars@redcloudfs.com.", group: "Coming" },
  { name: "TRELLO_KEY", label: "Trello key", for: "Opens a Trello card per webinar. Off until set.", group: "Coming" },
  { name: "TRELLO_TOKEN", label: "Trello token", for: "Goes with the Trello key.", group: "Coming" },
  { name: "TRELLO_LIST_ID", label: "Trello list ID", for: "Which list the cards go in.", group: "Coming" },
];
const ALLOWED = new Set(KNOWN.map((k) => k.name));

function load() {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(map) {
  const dir = FILE.slice(0, FILE.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(map, null, 2), { mode: 0o600 });
  renameSync(`${FILE}.tmp`, FILE);
}

const fromEnvFile = {};        // what .env said at start-up, to fall back to on "clear"

/** At start-up: remember .env's values, then apply anything saved on the Keys page. */
export function applySaved() {
  for (const k of ALLOWED) if (process.env[k]) fromEnvFile[k] = process.env[k];
  const saved = load();
  for (const [k, v] of Object.entries(saved)) if (ALLOWED.has(k) && v) process.env[k] = v;
  return Object.keys(saved).filter((k) => ALLOWED.has(k));
}

export function setKey(name, value) {
  if (!ALLOWED.has(name)) return { ok: false, error: "Unknown key." };
  const v = String(value || "").trim();
  if (!v) return { ok: false, error: "Paste a value." };
  if (/\s/.test(v) && name !== "MAIL_FROM") return { ok: false, error: "That has spaces in it — keys never do. Check it was copied whole." };
  const map = load(); map[name] = v; save(map);
  process.env[name] = v;                                   // live at once, no restart
  return { ok: true };
}

export function clearKey(name) {
  if (!ALLOWED.has(name)) return { ok: false, error: "Unknown key." };
  const map = load(); delete map[name]; save(map);
  if (fromEnvFile[name]) process.env[name] = fromEnvFile[name]; else delete process.env[name];
  return { ok: true };
}

/** For the page: set or not, where from, and the last four characters — never the value. */
export function status() {
  const saved = load();
  return KNOWN.map((k) => {
    const v = process.env[k.name] || "";
    return { ...k, set: Boolean(v), source: saved[k.name] ? "Keys page" : v ? ".env" : null,
             tail: v && k.name !== "MAIL_FROM" ? v.slice(-4) : (k.name === "MAIL_FROM" ? v : "") };
  });
}
