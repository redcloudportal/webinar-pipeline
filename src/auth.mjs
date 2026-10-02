import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";

/* ── one shared password, set by a one-time link ───────────────
   The pipeline is internal: everything sits behind a sign-in. There is one
   password for the team, stored only as an scrypt hash in the data volume
   (/data/auth.json) — never in the repo, never in .env, never in chat.

   It is set through a SINGLE-USE link that expires in 24 hours, generated on
   the server (`node src/admin.mjs setup-link`). Opening it lets someone choose
   the password; using it destroys it. The same link resets the password later.

   A session is a signed cookie lasting 30 days. Its signature includes a
   fingerprint of the current password hash, so changing the password signs
   everybody out at once.
   ───────────────────────────────────────────────────────────── */

const DATA = process.env.DATA_DIR || "/data";
const FILE = `${DATA}/auth.json`;
const DAY = 864e5;
export const SESSION_DAYS = 30;

function load() {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(state) {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
}

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

export const hasPassword = () => Boolean(load().password);

function hash(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString("hex")}$${key.toString("hex")}`;
}
function verify(pw, stored) {
  const [alg, n, salt, key] = String(stored || "").split("$");
  if (alg !== "scrypt") return false;
  const want = Buffer.from(key, "hex");
  const got = scryptSync(String(pw), Buffer.from(salt, "hex"), want.length, { N: Number(n), r: 8, p: 1 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ── the one-time link ── */
export function issueSetupToken(hours = 24) {
  const token = randomBytes(24).toString("base64url");
  const state = load();
  state.setup = { tokenHash: sha(token), expires: Date.now() + Math.min(120, hours) * 36e5 };
  save(state);
  return token;
}
export function setupTokenValid(token) {
  const s = load().setup;
  return Boolean(s && token && sha(token) === s.tokenHash && Date.now() < s.expires);
}
export function setPasswordWithToken(token, pw) {
  if (!setupTokenValid(token)) return { ok: false, error: "This link has expired or has already been used." };
  /* No length rule — Cliff's call (2 Oct 2026). Anything but empty is accepted;
     the lockout after repeated wrong tries is the protection that stays. */
  if (!String(pw).length) return { ok: false, error: "Enter a password." };
  const state = load();
  state.password = hash(pw);
  state.changed = new Date().toISOString();
  delete state.setup;                                   // single use
  save(state);
  return { ok: true };
}

/* ── signing in ── */
export function checkPassword(pw) {
  const stored = load().password;
  return Boolean(stored) && verify(pw, stored);
}

const secret = () => process.env.SESSION_SECRET || "";
const fingerprint = () => sha(load().password || "").slice(0, 16);
const sign = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function newSession() {
  const exp = Date.now() + SESSION_DAYS * DAY;
  const payload = `${exp}.${fingerprint()}`;
  return `${exp}.${sign(payload)}`;
}
export function sessionValid(cookieValue) {
  if (!secret() || !cookieValue) return false;
  const [exp, sig] = String(cookieValue).split(".");
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const want = sign(`${exp}.${fingerprint()}`);
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

/* ── slowing down guessing ── 8 wrong tries in 15 minutes locks that address for 15 minutes */
const tries = new Map();
const WINDOW = 15 * 60e3, LIMIT = 8;
export function lockedOut(ip) {
  const t = tries.get(ip);
  if (!t) return false;
  if (Date.now() - t.first > WINDOW) { tries.delete(ip); return false; }
  return t.count >= LIMIT;
}
export function noteFailure(ip) {
  const t = tries.get(ip);
  if (!t || Date.now() - t.first > WINDOW) tries.set(ip, { first: Date.now(), count: 1 });
  else t.count++;
}
export const clearFailures = (ip) => tries.delete(ip);
