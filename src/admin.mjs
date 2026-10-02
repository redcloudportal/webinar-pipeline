import { issueSetupToken, hasPassword } from "./auth.mjs";

/* Run ON THE SERVER, inside the container:

     docker compose exec -T pipeline node src/admin.mjs setup-link

   Prints a single-use link (valid 24 hours) for choosing — or resetting — the
   sign-in password. Generating a new link cancels any earlier unused one. */

const cmd = process.argv[2];
if (cmd === "setup-link") {
  const base = (process.env.PUBLIC_URL || "https://webinarform.redcloudfs.com").replace(/\/+$/, "");
  const token = issueSetupToken();
  console.log(`${hasPassword() ? "Password RESET" : "Password setup"} link (single use, expires in 24 hours):`);
  console.log(`${base}/setup?t=${token}`);
} else {
  console.log("usage: node src/admin.mjs setup-link");
  process.exit(1);
}
