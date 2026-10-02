import { issueSetupToken, hasPassword } from "./auth.mjs";

/* Run ON THE SERVER, inside the container:

     docker compose exec -T pipeline node src/admin.mjs setup-link

   Prints a single-use link (valid 24 hours) for choosing — or resetting — the
   sign-in password. Generating a new link cancels any earlier unused one. */

const cmd = process.argv[2];
if (cmd === "setup-link") {
  /* --hours N: how long the link lives (default 24, at most 120 — e.g. to last a weekend) */
  const i = process.argv.indexOf("--hours");
  const hours = Math.min(120, Math.max(1, Number(i > 0 ? process.argv[i + 1] : 24) || 24));
  const base = (process.env.PUBLIC_URL || "https://webinars.redcloudfs.com").replace(/\/+$/, "");
  const token = issueSetupToken(hours);
  console.log(`${hasPassword() ? "Password RESET" : "Password setup"} link (single use, expires in ${hours} hours):`);
  console.log(`${base}/setup?t=${token}`);
} else {
  console.log("usage: node src/admin.mjs setup-link");
  process.exit(1);
}
