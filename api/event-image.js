// Event card image (Vercel Node function): GET /api/event-image?id=<event id>
// Looks up the event's own registration link in Supabase (never a URL from the request), reads the
// organizer's page and returns its promo image (og:image). The CDN keeps the answer for a week, so each
// organizer page is read about once a week, not once per visitor. No image → 404, and the card shows the
// movement family's shape instead.
import { findImage, worthFetching } from "../images/og.js";

// Public read-only key, the same one index.html ships (row-level security limits it to published data).
const SB_URL = "https://eiseowpkwexktqrtoeaq.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpc2Vvd3Brd2V4a3RxcnRvZWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MTQwMjEsImV4cCI6MjEwNTk5MDAyMX0.sVsFmBZUWwfvRL_pt3SMgkggy_GNCRKrWGdzHpg0qHg";

const WEEK = 7 * 24 * 3600, DAY = 24 * 3600;
const MAX_PAGE = 1_500_000, MAX_IMG = 5_000_000;
const UA = "Mozilla/5.0 (compatible; zuzu.today event image; +https://zuzu.today)";

async function fetchCapped(url, { accept, max, timeoutMs }, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: ctl.signal });
    if (!r.ok || !r.body) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len && len > max) return null;
    const chunks = []; let size = 0;
    for await (const c of r.body) { size += c.length; if (size > max) return null; chunks.push(c); }
    return { res: r, buf: Buffer.concat(chunks) };
  } catch { return null; } finally { clearTimeout(t); }
}

export default async function handler(req, res, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const miss = (why, ttl = DAY) => {
    res.setHeader("Cache-Control", `public, max-age=3600, s-maxage=${ttl}`);
    res.setHeader("X-Zuzu-Image", why);
    return res.status(404).end();
  };
  const id = String(req.query?.id || "");
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) return miss("bad-id", WEEK);

  const key = deps.anonKey || process.env.SUPABASE_ANON_KEY || SB_ANON;
  let link = null;
  try {
    const r = await fetchImpl(`${SB_URL}/rest/v1/events?select=link&id=eq.${id}&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const rows = r.ok ? await r.json() : [];
    link = rows[0]?.link || null;
  } catch { return miss("db-error", 600); }
  if (!link || !worthFetching(link)) return miss("no-link", WEEK);

  const page = await fetchCapped(link, { accept: "text/html,application/xhtml+xml", max: MAX_PAGE, timeoutMs: 6000 }, fetchImpl);
  if (!page) return miss("page-unreachable");
  const src = findImage(page.buf.toString("utf8"), page.res.url || link);
  if (!src) return miss("no-og-image", WEEK);

  const img = await fetchCapped(src, { accept: "image/avif,image/webp,image/*", max: MAX_IMG, timeoutMs: 6000 }, fetchImpl);
  const type = img?.res.headers.get("content-type") || "";
  if (!img || !/^image\/(jpeg|png|webp|gif|avif)/i.test(type)) return miss("image-unreachable");

  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", `public, max-age=${DAY}, s-maxage=${WEEK}, stale-while-revalidate=${DAY}`);
  res.setHeader("X-Zuzu-Image-Source", src.slice(0, 300));
  return res.status(200).send(img.buf);
}
