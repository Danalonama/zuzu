// Deep Contact (deepcontact.org, WordPress). Two post types in its REST API:
//   yesodot      — foundation courses (weekly),   e.g. "קורס יסודות 15.09.2026 ת א ימי שלישי 19:00-21:30"
//   mavoyesodot  — intro workshops (one meeting, or weekly when the title says "ימי …")
// Date, place, weekday and time are read from the title only. The site's own date fields are early-bird
// cut-offs, not meeting dates, so they are ignored. No Claude, nothing invented: a title that doesn't
// match is reported, not guessed. Teachers and the number of meetings aren't in the title.
import { addDays, parseIso } from "../bot/normalize.js";

export const source = "deepcontact";
const BASE = "https://deepcontact.org/wp-json/wp/v2/";
export const TYPES = { yesodot: "course", mavoyesodot: "workshop" };
const COURSE_DAYS = 91; // no end date in the title → the plan's default: 3 months, then "still running?"

const HE_DAYS = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 };
// Place word in the title (or the page address) → the venue Deep Contact uses there (from the events added by hand).
const PLACES = [
  { re: /(^|[\s/_-])(ת\s?"?א|תל[\s-]?אביב|tlv|tel-?aviv)($|[\s/_-])/i, venue: "האחים מסלאוויטה 7", city: "תל אביב-יפו" },
  { re: /(^|[\s/_-])(שרון|השרון|עדנים|sharon)($|[\s/_-])/i, venue: "סטודיו דרך הגנים", city: "עדנים" },
  { re: /(^|[\s/_-])(בית[\s-]?לחם(\s?הגלילית)?|blg)($|[\s/_-])/i, venue: "יער המאכל", city: "בית לחם הגלילית" },
];

const decode = (s) => String(s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

const pad = (n) => String(n).padStart(2, "0");

/** Title (+ page address) → schedule and place, or { error }. Pure. */
export function parseTitle(title, link = "") {
  const t = decode(title);
  const d = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/);
  if (!d) return { error: "אין תאריך בכותרת" };
  const year = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  const date = `${year}-${pad(d[2])}-${pad(d[1])}`;
  if (!parseIso(date)) return { error: `תאריך לא תקין: ${d[0]}` };
  const tm = t.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/) || t.match(/(\d{1,2}):(\d{2})/);
  const time_start = tm ? `${pad(tm[1])}:${tm[2]}` : null;
  const time_end = tm && tm[3] ? `${pad(tm[3])}:${tm[4]}` : null;
  const wd = t.match(/(?:ימי|יום)\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/);
  const weekday = wd ? HE_DAYS[wd[1]] : null;
  let path = "";
  try { path = decodeURIComponent(new URL(link).pathname); } catch { /* no link */ }
  const place = PLACES.find((p) => p.re.test(t)) || PLACES.find((p) => p.re.test(path)) || null;
  return { date, time_start, time_end, weekday, weekdayName: wd ? wd[1] : null, place, clean: t };
}

/** One WordPress post → { key, source_title, ext } (ext in the bot's extraction shape), or with skip. */
export function toItem(post, type) {
  const source_title = decode(post.title?.rendered);
  const link = post.link || null;
  const key = `${source}:${type}:${post.id}`;
  const p = parseTitle(post.title?.rendered, link || "");
  if (p.error) return { key, source_title, skip: p.error };
  if (!p.place) return { key, source_title, skip: "לא ברור איפה (אין עיר מוכרת בכותרת או בכתובת)" };
  const format = TYPES[type];
  const weekly = format === "course" || p.weekday != null;
  const label = format === "course" ? "קורס יסודות בקונטקט אימפרוביזציה" : "סדנת מבוא לקונטקט אימפרוביזציה";
  const when = weekly && p.weekdayName ? `ימי ${p.weekdayName}` : null;
  return {
    key, source_title,
    ext: {
      title: `Deep Contact — ${label}${when ? ` (${when})` : ""}`,
      language: "he",
      description: null,
      disciplines: ["contact"],
      formats: [format],
      audience: ["beginners_welcome"],
      venue_name: p.place.venue,
      city: p.place.city,
      location_on_registration: false,
      hosts: [{ name: "Deep Contact", kind: "org" }],
      schedule: {
        kind: weekly ? "weekly" : "once",
        date_start: p.date, date_end: null,
        weekdays: weekly && p.weekday != null ? [p.weekday] : [],
        interval_weeks: 1, sessions_count: null,
        valid_until: weekly ? addDays(p.date, COURSE_DAYS) : null,
        time_start: p.time_start, time_end: p.time_end, skip_dates: [],
      },
      price: { raw: null, kind: null, min: null, max: null, unit: null },
      link, phones: [], parent_index: null,
      notes: weekly ? "מספר המפגשים לא מופיע באתר — סיום משוער אחרי 3 חודשים" : null,
      source_quote: source_title,
    },
  };
}

export async function fetchItems(fetchImpl = fetch) {
  const out = [];
  for (const type of Object.keys(TYPES)) {
    const r = await fetchImpl(`${BASE}${type}?per_page=100&_fields=id,link,title,modified,status`, { headers: { "User-Agent": "zuzu.today feed (+https://zuzu.today)" } });
    if (!r.ok) throw new Error(`deepcontact ${type}: HTTP ${r.status}`);
    const posts = await r.json();
    for (const p of posts) if (!p.status || p.status === "publish") out.push(toItem(p, type));
  }
  return out;
}

export default { source, fetchItems };
