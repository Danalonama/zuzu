// Editing page backend (Vercel Node function). The page (edit.html) never sees the Supabase service key:
// it sends the editing password, this function checks it and does the write. Setup: admin/README.md.
import { createHash, timingSafeEqual } from "node:crypto";
import { createSupabase } from "../bot/supabase.js";
import { ACTIONS, AdminError, load, lookups } from "../admin/actions.js";

const digest = (s) => createHash("sha256").update(String(s)).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function passwordOk(given, expected = process.env.ADMIN_PASSWORD) {
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export default async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  // Too short = easy to guess from outside; refuse to run rather than be open.
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    return res.status(503).json({ ok: false, error: "ADMIN_PASSWORD לא מוגדר ב-Vercel (לפחות 12 תווים)" });
  }
  // The page sends it URI-encoded: a header can't carry Hebrew letters as they are.
  let given = "";
  try { given = decodeURIComponent(req.headers["x-admin-password"] || ""); } catch {}
  if (!passwordOk(given)) {
    await sleep(1000); // slows down guessing
    return res.status(401).json({ ok: false, error: "סיסמה שגויה" });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; }
  catch { return res.status(400).json({ ok: false, error: "bad JSON" }); }

  try {
    const sb = deps.sb || createSupabase();
    if (body.action === "load") return res.status(200).json({ ok: true, ...(await load(sb)) });
    const fn = ACTIONS[body.action];
    if (!fn) return res.status(400).json({ ok: false, error: `פעולה לא מוכרת: ${body.action}` });
    const result = await fn(sb, await lookups(sb), body.args || {});
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    if (e instanceof AdminError) return res.status(e.status).json({ ok: false, error: e.message, current: e.current });
    console.error("zuzu admin:", body.action, e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
