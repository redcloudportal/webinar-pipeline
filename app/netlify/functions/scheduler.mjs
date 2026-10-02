import { list, mark } from "../shared/record.mjs";
import { CONNECTORS, runOne, MAX_ATTEMPTS } from "../shared/connectors.mjs";

/* Runs on a cron. Finds every timed connector whose moment has arrived and has
   not already fired, and fires it.

   Three guards keep this safe:
     · a connector that has already run is never run again (runOne checks)
     · anything more than 48 hours overdue is skipped, so switching this on does
       not blast a backlog of emails about webinars that already happened
     · a connector that has failed MAX_ATTEMPTS times is left alone. It used to
       be retried every 15 minutes for the full 48 hours — ~190 attempts against
       a provider that had already said no. /ops still has a Retry button.
   ────────────────────────────────────────────────────────────── */

const OVERDUE_LIMIT_MIN = 48 * 60;

export default async () => {
  let records;
  try {
    records = await list();
  } catch (err) {
    console.error("scheduler: could not read records:", err.message);
    return new Response("store unavailable", { status: 200 });
  }

  const now = Date.now();
  const timed = CONNECTORS.filter((c) => typeof c.when === "object");
  const fired = [];
  const skipped = [];
  const exhausted = [];

  for (const rec of records) {
    const startISO = rec.schedule?.startTimeISO;
    if (!startISO) continue;                       // no confirmed time yet — nothing is due
    const start = new Date(startISO).getTime();
    if (isNaN(start)) continue;

    for (const c of timed) {
      const step = rec.steps?.[c.key];
      if (step?.status === "done") continue;
      if (step?.status === "failed" && (step.attempts || 0) >= MAX_ATTEMPTS) {
        exhausted.push(`${rec.id}:${c.key}`);
        continue;
      }
      const dueAt = start + c.when.offsetMinutes * 60000;
      if (now < dueAt) continue;

      const lateBy = (now - dueAt) / 60000;
      if (lateBy > OVERDUE_LIMIT_MIN) {
        if (!rec.steps?.[c.key]) {
          await mark(rec.id, c.key, "skipped", `More than 48h overdue — not sent`);
          skipped.push(`${rec.id}:${c.key}`);
        }
        continue;
      }
      const out = await runOne(c, rec, mark);
      fired.push(`${rec.id}:${c.key}=${out.status}`);
    }
  }

  console.log(
    `scheduler: ${records.length} record(s); fired ${fired.length}` +
    (fired.length ? ` [${fired.join(", ")}]` : "") +
    (skipped.length ? `; skipped as stale [${skipped.join(", ")}]` : "") +
    (exhausted.length ? `; giving up after ${MAX_ATTEMPTS} failures [${exhausted.join(", ")}]` : ""),
  );
  return new Response("ok", { status: 200 });
};

export const config = { schedule: "*/15 * * * *" };
