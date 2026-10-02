import { boxConfig, getAccessToken, ensureFolder, uploadFile, safeName, folderInfo, folderLink, resolveClientFolder } from "../box.mjs";
import { rememberFolder, knownFolder, noteFolderGone, folderWasDeleted , webinarDateKey } from "../record.mjs";

/* Step 25 — file the content sheet and the client's assets into Box.

   Same shape as the Drive connector, and the two are interchangeable: whichever
   has its variables set is the one that runs. Both configured means both run,
   which is a valid way to migrate. */

export const key   = "box_storage";
export const label = "File to Box";
export const steps = [25];
export const needs = ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET", "BOX_SUBJECT_ID", "BOX_FOLDER_ID"];
export const when  = "on-create";

export async function run(rec) {
  const cfg = boxConfig();
  const token = await getAccessToken();
  const company = safeName(rec.facts.company);

  /* the broadcast date once Red Cloud has set one, otherwise the submission date */
  const folderId = await resolveClientFolder(
    rec, token, { knownFolder, rememberFolder, noteFolderGone, folderWasDeleted, dateStamp: webinarDateKey },
  );
  if (!folderId) {
    return { status: "skipped", detail: "Box folder was deleted, so nothing was re-filed. Submit again to start a fresh folder." };
  }

  await uploadFile({
    name: `${company} — webinar content sheet.txt`,
    mimeType: "text/plain; charset=utf-8",
    data: Buffer.from(rec.facts.summary || "(no summary submitted)", "utf8"),
    parentId: folderId, token,
  });

  await uploadFile({
    name: "submission.json",
    mimeType: "application/json",
    data: Buffer.from(JSON.stringify({ id: rec.id, createdAt: rec.createdAt, facts: rec.facts }, null, 2), "utf8"),
    parentId: folderId, token,
  });

  /* One unreadable upload must not cost the whole folder — the sheet is already
     safely filed by this point, so a bad file is logged and stepped over. */
  let saved = 0;
  const failures = [];
  for (const url of rec.files || []) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download returned ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const name = safeName(
        decodeURIComponent(new URL(url).pathname.split("/").pop() || "file"),
        "attachment",
      );
      await uploadFile({
        name, mimeType: res.headers.get("content-type") || "application/octet-stream",
        data: buf, parentId: folderId, token,
      });
      saved++;
    } catch (err) {
      console.error(`box_storage: could not copy ${url}:`, err.message);
      failures.push(err.message);
    }
  }

  const total = (rec.files || []).length;
  return {
    detail: `Filed the content sheet and ${saved}/${total} client file${total === 1 ? "" : "s"}` +
            (failures.length ? ` — ${failures.length} could not be copied` : ""),
    ref: folderLink(folderId),
  };
}

export async function check() {
  const cfg = boxConfig();
  const token = await getAccessToken();
  const info = await folderInfo(cfg.folder, token);
  const path = (info.path_collection?.entries || []).map((e) => e.name).concat(info.name).join(" / ");
  return `Connected. Submissions will be filed into "${path}".`;
}
