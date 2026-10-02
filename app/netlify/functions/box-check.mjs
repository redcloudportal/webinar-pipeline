import { boxConfig, getAccessToken, ensureFolder, uploadFile, folderInfo, whoAmI, folderLink } from "../shared/box.mjs";

/* Proves the Box filing works, in plain English, before anyone trusts it with a
   client's asset pack. Signs in, says who it is signed in AS, reads the target
   folder, writes a file into a test folder, and names the specific thing that is
   wrong if it cannot.

   The failure this exists for: a Client Credentials app authenticating as the
   enterprise acts as its own Service Account user, which starts with an empty
   Box and cannot see anyone's folders until one is shared with it. The symptom
   is a bare 404 on a folder id that is plainly correct. */

export default async () => {
  const out = (ok, message, detail) =>
    new Response(JSON.stringify({ ok, message, ...(detail ? { detail } : {}) }, null, 2), {
      status: ok ? 200 : 400,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  const cfg = boxConfig();
  if (!cfg.ready) {
    return out(false, "Not configured yet.", `Missing: ${cfg.missing.join(", ")}`);
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    return out(false, "The Box app could not sign in.", err.message);
  }

  /* who the app actually is, which is the thing people get wrong */
  let me;
  try {
    me = await whoAmI(token);
  } catch (err) {
    return out(false, "Signed in, but could not read the account.", err.message);
  }

  let folder;
  try {
    folder = await folderInfo(cfg.folder, token);
  } catch (err) {
    return out(
      false,
      `Signed in as "${me.name}" (${me.login}), but could not open BOX_FOLDER_ID.`,
      `${err.message} Share the target folder with ${me.login} as Editor, then try again.`,
    );
  }

  try {
    const testFolder = await ensureFolder("_connection test", cfg.folder, token);
    const file = await uploadFile({
      name: "connection-test.txt",
      mimeType: "text/plain; charset=utf-8",
      data: Buffer.from("Red Cloud webinar form — connection test. Safe to delete.\n", "utf8"),
      parentId: testFolder, token,
    });
    const path = (folder.path_collection?.entries || []).map((e) => e.name).concat(folder.name).join(" / ");
    return out(
      true,
      `Working. Submissions will be filed into "${path}".`,
      `Signed in as "${me.name}" (${me.login}) as ${cfg.subjectType}. Wrote a test file ` +
      `(id ${file.id}) into a "_connection test" folder — open ${folderLink(testFolder)} and delete it.`,
    );
  } catch (err) {
    return out(
      false,
      `Signed in as "${me.name}" and can see the folder, but could not write to it.`,
      `${err.message} The account needs the Editor role on that folder, not Viewer.`,
    );
  }
};

export const config = { path: "/api/box-check" };
