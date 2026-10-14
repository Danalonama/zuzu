// Daily Deep Contact feed (Vercel Cron, see vercel.json). Setup and switches: feeds/README.md.
// Runs dry (writes nothing to events) unless FEEDS_LIVE lists "deepcontact".
import adapter from "../../feeds/deepcontact.js";
import { runFeed, saveRun } from "../../feeds/run.js";
import { summary } from "../../feeds/notify.js";
import { createSupabase } from "../../bot/supabase.js";
import { createTelegram } from "../../bot/telegram.js";
import { ownerIds } from "../../bot/handlers.js";

export const config = { maxDuration: 300 };

export const isLive = (env = process.env) => String(env.FEEDS_LIVE || "").split(/[,\s]+/).includes(adapter.source);

export default async function handler(req, res) {
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET". No secret set = nobody can run it.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).end();

  const sb = createSupabase();
  let report = null, error = null;
  try {
    report = await runFeed(adapter, { sb, dryRun: !isLive() });
  } catch (e) {
    error = e;
    console.error("zuzu feeds: deepcontact", e);
  }
  await saveRun(sb, report || { source: adapter.source, dry_run: !isLive() }, error);
  try {
    const tg = createTelegram();
    for (const id of ownerIds()) await tg.send(id, summary(report || { source: adapter.source }, error));
  } catch (e) {
    console.error("zuzu feeds: telegram", e.message);
  }
  return res.status(error ? 500 : 200).json(error ? { ok: false, error: String(error.message || error) } : { ok: true, ...report });
}
