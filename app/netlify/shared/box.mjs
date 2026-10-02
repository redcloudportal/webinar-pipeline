/* ─────────────────────────────────────────────────────────────
   Box via a Custom App using the Client Credentials Grant.
   No SDK, no keypair — a token call, then plain REST.

   IMPORTANT, and the exact same trap as Google Drive: when the
   app authenticates as the ENTERPRISE it acts as the app's own
   Service Account user, which has its own empty root folder. It
   cannot see anybody's files until a folder is explicitly shared
   with it. BOX_FOLDER_ID must be a folder that the Service
   Account has been invited to as Editor — or set
   BOX_SUBJECT_TYPE=user and BOX_SUBJECT_ID to a real user id to
   act as that person instead. boxError() turns the resulting 404
   into a sentence rather than leaving it as "not found".
   ───────────────────────────────────────────────────────────── */

const TOKEN_URL  = "https://api.box.com/oauth2/token";
const API        = "https://api.box.com/2.0";
const UPLOAD_API = "https://upload.box.com/api/2.0";

export function boxConfig() {
  const clientId     = process.env.BOX_CLIENT_ID;
  const clientSecret = process.env.BOX_CLIENT_SECRET;
  const subjectId    = process.env.BOX_SUBJECT_ID;
  const folder       = process.env.BOX_FOLDER_ID;
  /* "enterprise" = act as the app's Service Account (needs the folder shared
     with it). "user" = act as a named person (needs the app authorised to
     generate user tokens). */
  const subjectType  = process.env.BOX_SUBJECT_TYPE === "user" ? "user" : "enterprise";

  const missing = [
    !clientId     && "BOX_CLIENT_ID",
    !clientSecret && "BOX_CLIENT_SECRET",
    !subjectId    && "BOX_SUBJECT_ID",
    !folder       && "BOX_FOLDER_ID",
  ].filter(Boolean);

  return { clientId, clientSecret, subjectId, subjectType, folder, missing, ready: missing.length === 0 };
}

/* Box tokens last an hour. A warm function instance can reuse one rather than
   asking for a new token on every submission. */
let cached = { token: null, expiresAt: 0 };

export async function getAccessToken() {
  const cfg = boxConfig();
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      box_subject_type: cfg.subjectType,
      box_subject_id: cfg.subjectId,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = json.error === "invalid_client"
      ? " Check BOX_CLIENT_ID and BOX_CLIENT_SECRET, and that the app is authorised in the Box admin console."
      : json.error === "invalid_grant" || json.error === "unauthorized_client"
        ? " Check BOX_SUBJECT_ID, and that the app has 'Generate user access tokens' enabled if BOX_SUBJECT_TYPE=user."
        : "";
    throw new Error(
      `Box refused the app credentials (${res.status}). ${json.error_description || json.error || ""}${hint}`.trim(),
    );
  }

  cached = {
    token: json.access_token,
    /* refresh a minute early so a long upload cannot straddle the expiry */
    expiresAt: Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000,
  };
  return cached.token;
}

function boxError(status, body, what) {
  const code = body?.code || "";
  const msg  = body?.message || `HTTP ${status}`;

  if (status === 404 || code === "not_found") {
    return new Error(
      "Box could not find that folder. Check BOX_FOLDER_ID — and remember the app's Service " +
      "Account starts with an empty Box of its own, so the folder must be shared with it as " +
      "Editor before it can see it. (Its address is shown by /api/box-check.)",
    );
  }
  if (status === 403 || code === "access_denied_insufficient_permissions") {
    return new Error(
      "Box refused the write. The app can see that folder but cannot write to it — the Service " +
      "Account needs the Editor role, not Viewer, and the app needs 'Write all files and folders'.",
    );
  }
  if (status === 401) {
    return new Error("Box rejected the access token. Re-check the app credentials and its authorisation status.");
  }
  if (code === "storage_limit_exceeded") {
    return new Error("The Box account is out of storage.");
  }
  return new Error(`Box API error ${status}${what ? ` (${what})` : ""}: ${msg}`);
}

async function boxFetch(url, opts, token, what) {
  const res = await fetch(url, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = boxError(res.status, body, what);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Conflicting item from a 409, whether Box returned one object or a list. */
function conflictId(body) {
  const c = body?.context_info?.conflicts;
  if (Array.isArray(c)) return c[0]?.id || null;
  return c?.id || null;
}

/** Find a child folder by name, or create it. */
export async function ensureFolder(name, parentId, token) {
  try {
    const made = await boxFetch(
      `${API}/folders`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, parent: { id: String(parentId) } }),
      },
      token,
      "create folder",
    );
    return made.id;
  } catch (err) {
    /* Box answers a duplicate name with 409 and tells us which item it clashed
       with — that IS the folder we wanted, so this is the success path on a
       re-run, not an error. Cheaper and more atomic than searching first. */
    if (err.status === 409) {
      const id = conflictId(err.body);
      if (id) return id;
    }
    throw err;
  }
}

/** Upload a Buffer. On a name clash it writes a new version rather than a duplicate. */
export async function uploadFile({ name, mimeType, data, parentId, token }) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const blob = new Blob([body], { type: mimeType || "application/octet-stream" });

  const form = new FormData();
  form.append("attributes", JSON.stringify({ name, parent: { id: String(parentId) } }));
  form.append("file", blob, name);

  try {
    const out = await boxFetch(`${UPLOAD_API}/files/content`, { method: "POST", body: form }, token, "upload");
    return out.entries?.[0] || out;
  } catch (err) {
    if (err.status === 409) {
      const existing = conflictId(err.body);
      if (existing) {
        const form2 = new FormData();
        form2.append("attributes", JSON.stringify({ name }));
        form2.append("file", blob, name);
        const out = await boxFetch(
          `${UPLOAD_API}/files/${existing}/content`,
          { method: "POST", body: form2 },
          token,
          "upload new version",
        );
        return out.entries?.[0] || out;
      }
    }
    throw err;
  }
}

/** Rename a folder in place, keeping its id, contents and share links. */
export async function renameFolder(folderId, name, token) {
  return boxFetch(
    `${API}/folders/${folderId}`,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) },
    token,
    "rename folder",
  );
}

export async function folderInfo(folderId, token) {
  return boxFetch(`${API}/folders/${folderId}?fields=id,name,path_collection`, {}, token, "read folder");
}

/* Delete a client folder and everything in it.
   `recursive=true` because these always hold a Graphics subfolder. Box moves
   it to trash rather than destroying it, so a mistake is recoverable from the
   Box UI for the retention period. A folder that is already gone counts as
   success — the caller wanted it gone and it is. */
export async function deleteFolder(folderId, token) {
  try {
    await boxFetch(`${API}/folders/${folderId}?recursive=true`, { method: "DELETE" }, token, "delete folder");
    return { deleted: true };
  } catch (err) {
    if (err.status === 404) return { deleted: false, alreadyGone: true };
    throw err;
  }
}

export async function whoAmI(token) {
  return boxFetch(`${API}/users/me?fields=id,name,login`, {}, token, "identify");
}

/** Web link for a file or folder, for the /ops "open" button. */
export const fileLink   = (id) => `https://app.box.com/file/${id}`;
export const folderLink = (id) => `https://app.box.com/folder/${id}`;

/** Box rejects / and \, leading or trailing whitespace, and "." or "..". */
export function safeName(s, fallback = "Unnamed company") {
  const cleaned = String(s || "")
    .replace(/[\/\\]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 200)
    .trim();
  return cleaned || fallback;
}

/* ── the client's folder, resolved once and remembered ─────────
   The id is stored on the record so every connector files into
   the same place. But a remembered id can go stale — somebody
   tidies up in Box and the folder is gone — and a stale id used
   blindly makes every future run fail with "could not find that
   folder". So it is verified before use and re-created if it has
   disappeared.
   ───────────────────────────────────────────────────────────── */
export async function resolveClientFolder(
  rec, token, { knownFolder, rememberFolder, noteFolderGone, folderWasDeleted, dateStamp },
) {
  const cfg = boxConfig();
  const company = safeName(rec.facts.company);
  /* ── the WEBINAR's date, not the submission's ────────────────
     People look for a webinar under the day it goes out. The folder used to
     carry the day the form happened to be filled in, which for anything booked
     more than a week ahead put it under the wrong month entirely — and the
     portal's attendee-list import keys off the folder date too.

     Falls back to the submission date only while there is no date of any kind
     on the record, which is rare: the client gives one on the form. */
  const stamp = dateStamp(rec) || rec.createdAt.slice(0, 10);
  const wanted = `${company} — ${stamp}`;

  const remembered = await knownFolder(rec.id, "box");
  if (remembered) {
    try {
      const info = await folderInfo(remembered, token);
      /* Red Cloud moved the broadcast, so the folder is now filed under a day
         the webinar is not on. Renaming keeps the id — nothing already filed
         moves, and no share link breaks. A clash with a folder that already
         has the new name is not worth failing the run over: the old name is
         wrong but harmless, and someone can merge them by hand. */
      if (info.name !== wanted) {
        try {
          await renameFolder(remembered, wanted, token);
        } catch (err) {
          console.error(`box: could not rename folder ${remembered} to "${wanted}":`, err.message);
        }
      }
      return remembered;
    } catch (err) {
      if (err.status !== 404) throw err;
      /* Gone. It used to be recreated here, on the theory that the deletion
         was an accident. In practice deletions are deliberate — someone
         clearing out test submissions — and recreating meant every rebuild
         put the folder straight back. Tombstone it and stop. */
      console.log(`box: folder ${remembered} for ${rec.id} was deleted — not recreating`);
      if (noteFolderGone) await noteFolderGone(rec.id, "box");
      return null;
    }
  }

  /* deleted on an earlier run — never resurrect it */
  if (folderWasDeleted && (await folderWasDeleted(rec.id, "box"))) return null;

  const id = await ensureFolder(wanted, cfg.folder, token);
  await rememberFolder(rec.id, "box", id);
  return id;
}
