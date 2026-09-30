// Pure text/date helpers shared by matching and mapping. No I/O here.

const NIKUD = /[֑-ׇ]/g;
const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

// Words that don't identify a place/person on their own ("סטודיו תנע" = "תנע").
const VENUE_STOPWORDS = new Set([
  "סטודיו", "studio", "מרכז", "center", "centre", "the", "בית", "אולם", "hall", "space", "חלל",
]);

/** Lowercase, strip nikud / geresh / quotes / punctuation / emoji, unify final letters, collapse spaces. */
export function norm(s) {
  if (s == null) return "";
  return String(s)
    .normalize("NFKC")
    .replace(NIKUD, "")
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/['"`׳״’‘“”]/g, "")            // בוא'נה = בואנה
    .replace(/[^\p{L}\p{N}]+/gu, " ")        // punctuation, emoji, hyphens → space
    .replace(/\s+/g, " ")
    .trim();
}

/** Spelling-variant skeleton: drop ו/י inside words and collapse doubles (מסלאוויטה ≈ מסלויטה). */
export function skeleton(s) {
  return norm(s)
    .split(" ")
    .map((w) => (w.length > 2 ? w[0] + w.slice(1).replace(/[ויא]/g, "") : w))
    .join(" ")
    .replace(/(.)\1+/g, "$1");
}

function stripStop(s) {
  return s.split(" ").filter((w) => w && !VENUE_STOPWORDS.has(w)).join(" ");
}

function bigrams(s) {
  const t = s.replace(/ /g, "");
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Sørensen–Dice on character bigrams, 0..1. */
export function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  if (!na || !nb) return 0;
  for (const [g, v] of A) inter += Math.min(v, B.get(g) || 0);
  return (2 * inter) / (na + nb);
}

/**
 * Name similarity 0..1, tolerant of Hebrew spelling variants and generic words.
 * `stop` removes venue words like "סטודיו"; use it for venues, not for people.
 */
export function nameScore(a, b, { stop = false } = {}) {
  let na = norm(a), nb = norm(b);
  if (stop) { na = stripStop(na) || na; nb = stripStop(nb) || nb; }
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sa = skeleton(na), sb = skeleton(nb);
  if (sa === sb) return 0.95;
  let best = Math.max(dice(na, nb), dice(sa, sb));
  // Every word of the shorter name appears in the longer one ("תנע" in "תנע עין שמר").
  const wa = na.split(" "), wb = nb.split(" ");
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.join("").length >= 3 && short.every((w) => long.includes(w))) best = Math.max(best, 0.9);
  return best;
}

// ---------- phones ----------

/**
 * Normalize an Israeli phone to 0X-XXXXXXX / 05X-XXXXXXX / 07X-XXXXXXX.
 * Returns null when it can't produce something that passes the DB check
 * `^0[2-9][0-9]?-?[0-9]{7}$`.
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+972")) d = "0" + d.slice(4);
  else if (d.startsWith("972") && d.length >= 11) d = "0" + d.slice(3);
  d = d.replace(/\+/g, "");
  if (d.startsWith("00")) return null;
  let out = null;
  if (/^0[57]\d{8}$/.test(d)) out = d.slice(0, 3) + "-" + d.slice(3);       // 050-1234567, 077-1234567
  else if (/^0[2-489]\d{7}$/.test(d)) out = d.slice(0, 2) + "-" + d.slice(2); // 03-1234567
  return out && PHONE_RE.test(out) ? out : null;
}
export const PHONE_RE = /^0[2-9][0-9]?-?[0-9]{7}$/;
export const isMobile = (p) => /^05\d-?\d{7}$/.test(p || "");

// ---------- links ----------

export const LINK_RE = /^https?:\/\/[^ ]+\.[^ ]+/;

export function normalizeLink(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[)\].,;!?׳״"']+$/u, "");
  if (!/^https?:\/\//i.test(s) && /^(www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(s)) s = "https://" + s;
  if (/\s/.test(s)) return null;
  return LINK_RE.test(s) ? s : null;
}

// ---------- dates / times ----------

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIso(s) {
  if (!s || !ISO_DATE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}
export const toIso = (dt) => dt.toISOString().slice(0, 10);
export function addDays(iso, n) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
export const weekday = (iso) => parseIso(iso).getUTCDay(); // 0 = Sunday

/** "8:30" / "08:30" / "0830" / "20:00:00" → "08:30" (or null). */
export function normalizeTime(raw) {
  if (raw == null || raw === "") return null;
  const m = String(raw).trim().match(/^(\d{1,2})(?::|\.)?(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
}

/** Today in Israel, as YYYY-MM-DD. */
export function todayIL(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

/**
 * Dates of a weekly rule starting at `start`, stepping `interval` weeks,
 * skipping `skip` dates. Weeks are Sunday-based, as on the site.
 */
export function* weeklyDates(start, weekdays, interval = 1, skip = []) {
  const skipSet = new Set(skip);
  const wds = new Set(weekdays);
  const s = parseIso(start);
  const wk0 = new Date(s); wk0.setUTCDate(wk0.getUTCDate() - wk0.getUTCDay());
  for (let d = new Date(s), i = 0; i < 3660; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    if (!wds.has(d.getUTCDay())) continue;
    const wk = new Date(d); wk.setUTCDate(wk.getUTCDate() - wk.getUTCDay());
    if (Math.round((wk - wk0) / (7 * 864e5)) % interval !== 0) continue;
    const iso = toIso(d);
    if (!skipSet.has(iso)) yield iso;
  }
}

/** Date of the Nth meeting of a weekly course (skipped dates don't count as meetings). */
export function nthMeeting(start, weekdays, interval, n, skip = []) {
  let i = 0;
  for (const d of weeklyDates(start, weekdays, interval, skip)) if (++i === n) return d;
  return null;
}

/** First date ≥ from that falls on one of `weekdays`. */
export function firstOnOrAfter(from, weekdays) {
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (weekdays.includes(weekday(d))) return d;
  }
  return from;
}

const HE_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export const heDay = (n) => HE_DAYS[n];
export function heDate(iso, withYear = false) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}`;
}
