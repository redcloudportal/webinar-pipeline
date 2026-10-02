import { getAccessToken, uploadFile, safeName, folderLink, resolveClientFolder } from "../box.mjs";
import { rememberFolder, knownFolder, noteFolderGone, folderWasDeleted, webinarDateKey } from "../record.mjs";
import { socialRows, socialCsv, socialText } from "../social.mjs";

/* The social copy that goes out around the webinar: two look-ahead posts, two
   on the day, one for the replay, and one for every clip cut from it.

   Filed next to the graphics rather than mailed, because it is pasted into the
   client's content calendar — the CSV has that tab's own four columns, so it
   drops in whole. The .txt is the same thing to read.

   Runs after the graphics so each post can name the exact file it goes out
   with, and again whenever a broadcast time is saved, because every one of
   them quotes the date. */

export const key   = "social";
export const label = "Social copy";
export const steps = [11];
export const needs = ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET", "BOX_SUBJECT_ID", "BOX_FOLDER_ID"];
export const when  = "on-create";
export const rebuildOnSchedule = true;

export async function run(rec) {
  const token = await getAccessToken();
  const company = safeName(rec.facts.company);

  const folderId = await resolveClientFolder(
    rec, token, { knownFolder, rememberFolder, noteFolderGone, folderWasDeleted, dateStamp: webinarDateKey },
  );
  if (!folderId) {
    return { status: "skipped", detail: "Box folder was deleted, so nothing was written. Submit again to start a fresh folder." };
  }

  const rows = socialRows(rec);

  await uploadFile({
    name: `${company} — social copy.csv`,
    mimeType: "text/csv; charset=utf-8",
    data: Buffer.from("﻿" + socialCsv(rec), "utf8"),   // BOM, so Excel opens the emoji correctly
    parentId: folderId, token,
  });

  await uploadFile({
    name: `${company} — social copy.txt`,
    mimeType: "text/plain; charset=utf-8",
    data: Buffer.from(socialText(rec), "utf8"),
    parentId: folderId, token,
  });

  /* Say plainly what is still a placeholder. All of it is postable the moment
     those two are filled in, and nothing here guesses at them. */
  const gaps = [];
  if (!rec.schedule?.registrationUrl) gaps.push("registration link (guessed from the company name — set it in /ops)");
  if (!rec.schedule?.replayUrl) gaps.push("replay link (reads [REPLAY LINK] until the webinar has aired)");
  if (!rec.assets || !Object.keys(rec.assets).length) gaps.push("asset links (run the graphics first)");

  const clips = rows.filter((r) => r.when.startsWith("Clip")).length;
  const quoted = rows.filter((r) => r.quoted).length;

  return {
    detail: `Wrote ${rows.length} posts — look-ahead, day-of, replay` +
            (clips ? ` and ${clips} clip post${clips === 1 ? "" : "s"}` : "") +
            (quoted ? ` — ${quoted} quote${quoted === 1 ? "" : "s"} taken from the auto-transcript, so read those before posting` : "") +
            (gaps.length ? ` — still to fill in: ${gaps.join("; ")}` : ""),
    ref: folderLink(folderId),
  };
}

export async function check() {
  /* The copy is built from the record, so the only thing worth asserting is
     that it still produces every post and that none came out empty — a missing
     field used to show up as a sentence with a hole in it. */
  const sample = {
    id: "check", createdAt: new Date().toISOString(),
    schedule: { startTimeISO: null, startTime: "1:00pm ET / 10:00am PT" },
    facts: {
      company: "Example Mining Corp.", tickers: "TSXV: EXM | OTCQB: EXMPF",
      title: "Corporate Update", clientDate: "2026-12-02",
      speakers: [{ name: "A Person", title: "Chief Executive Officer" }],
    },
  };
  const rows = socialRows(sample);
  const empty = rows.filter((r) => !r.copy || /undefined|\[object/.test(r.copy));
  if (empty.length) return `BROKEN: ${empty.length} of ${rows.length} posts came out with holes in them.`;
  return `Ready. Writes ${rows.length} posts per webinar (plus one per clip) into the client's Box folder, as CSV and text.`;
}
