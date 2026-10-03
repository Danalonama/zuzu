// Extraction (Claude's JSON) → an `events` row + exceptions, validated against the DB constraints.
// Pure and deterministic: all the date arithmetic lives here, not in the prompt.
import {
  normalizePhone, normalizeLink, normalizeTime, parseIso, weekday, nthMeeting, firstOnOrAfter,
  addDays, LINK_RE, PHONE_RE, isMobile,
} from "./normalize.js";

export const AUDIENCE = ["women_only", "men_only", "beginners_welcome", "parents_with_kids", "sixty_plus", "partner_needed"];
export const FORMATS = ["circle", "class", "course", "event", "jam", "party", "performance", "program", "retreat", "workshop"];

const uniq = (a) => [...new Set(a)];
const validDate = (s) => (s && parseIso(s) ? s : null);

/**
 * @param ext   one entry of extraction.events
 * @param lk    lookups: { disciplines:[{slug}], formats:[], audience:[], priceKinds:[], priceUnits:[] }
 * @param today YYYY-MM-DD (Israel)
 * @returns { row, exceptions, warnings, errors }
 */
export function mapExtracted(ext, lk, today) {
  const warnings = [], errors = [];
  const discSlugs = new Set(lk.disciplines.map((d) => d.slug));
  const sch = ext.schedule || {};

  const row = {
    title: (ext.title || "").trim(),
    language: ext.language === "en" ? "en" : "he",
    description: ext.description?.trim() || null,
    disciplines: uniq((ext.disciplines || []).filter((s) => discSlugs.has(s))),
    formats: uniq((ext.formats || []).filter((s) => (lk.formats || FORMATS).includes(s))),
    audience: uniq((ext.audience || []).filter((s) => (lk.audience || AUDIENCE).includes(s))),
    location_on_registration: !!ext.location_on_registration,
    date_start: null, date_end: null, time_start: null, time_end: null,
    rule_weekdays: null, rule_interval_weeks: null, valid_until: null,
    price_raw: ext.price?.raw?.trim() || null,
    price_kind: lk.priceKinds?.includes(ext.price?.kind) ? ext.price.kind : null,
    price_unit: lk.priceUnits?.includes(ext.price?.unit) ? ext.price.unit : null,
    price_min: Number.isFinite(ext.price?.min) ? ext.price.min : null,
    price_max: Number.isFinite(ext.price?.max) ? ext.price.max : null,
    link: null, phone: null,
    status: "live",
    last_verified: today,
  };
  if (!row.title) errors.push("אין כותרת");
  if ((ext.disciplines || []).length !== row.disciplines.length) warnings.push("סוג תנועה לא מוכר הושמט");
  if (row.price_min != null && row.price_max != null && row.price_max < row.price_min) {
    [row.price_min, row.price_max] = [row.price_max, row.price_min];
  }

  // ---- times
  row.time_start = normalizeTime(sch.time_start);
  row.time_end = normalizeTime(sch.time_end);
  if (sch.time_start && !row.time_start) warnings.push(`שעה לא ברורה: ${sch.time_start}`);
  if (!row.time_start) warnings.push("אין שעת התחלה");

  // ---- schedule
  let skip = uniq((sch.skip_dates || []).filter(validDate)).sort();
  const start = validDate(sch.date_start);
  if (sch.date_start && !start) warnings.push(`תאריך לא תקין: ${sch.date_start}`);

  if (sch.kind === "weekly") {
    const wds = uniq((sch.weekdays || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)).sort();
    if (!wds.length && start) wds.push(weekday(start));
    if (!wds.length) errors.push("שיעור שבועי בלי יום בשבוע");
    let interval = Number.isInteger(sch.interval_weeks) ? sch.interval_weeks : 1;
    if (interval < 1 || interval > 4) { warnings.push(`מרווח ${interval} שבועות לא נתמך — נקבע 1`); interval = 1; }
    row.rule_weekdays = wds;
    row.rule_interval_weeks = interval;
    if (wds.length) {
      if (start) {
        row.date_start = wds.includes(weekday(start)) ? start : firstOnOrAfter(start, wds);
        if (row.date_start !== start) warnings.push(`תאריך ההתחלה ${start} לא ביום המפגש — הוזז ל-${row.date_start}`);
      } else {
        row.date_start = firstOnOrAfter(today, wds);
        warnings.push("לא צוין תאריך התחלה — מהמפגש הקרוב");
      }
      skip = skip.filter((d) => d >= row.date_start && wds.includes(weekday(d)));
      const stated = validDate(sch.valid_until);
      if (Number.isInteger(sch.sessions_count) && sch.sessions_count > 0) {
        row.valid_until = nthMeeting(row.date_start, wds, interval, sch.sessions_count, skip);
        if (stated && stated !== row.valid_until) warnings.push(`${sch.sessions_count} מפגשים מסתיימים ב-${row.valid_until}, בטקסט: ${stated}`);
      } else {
        row.valid_until = stated; // null = ongoing
      }
    }
  } else {
    if (!start) errors.push("אין תאריך");
    row.date_start = start;
    if (sch.kind === "range") {
      row.date_end = validDate(sch.date_end);
      if (!row.date_end) warnings.push("טווח בלי תאריך סיום");
    }
    if (row.date_end && row.date_start && row.date_end < row.date_start) errors.push("תאריך הסיום לפני ההתחלה");
    if (row.date_end === row.date_start) row.date_end = null;
    skip = skip.filter((d) => row.date_start && d >= row.date_start && d <= (row.date_end || row.date_start));
  }
  if (row.time_start && row.time_end && row.time_end <= row.time_start && !row.date_end) {
    warnings.push("שעת הסיום לפני ההתחלה (אחרי חצות?)");
  }

  // ---- past?
  const last = row.rule_weekdays ? row.valid_until : row.date_end || row.date_start;
  if (last && last < today) warnings.push("האירוע כבר עבר");
  if (row.date_start && row.date_start > addDays(today, 400)) warnings.push("תאריך רחוק מאוד — שנה נכונה?");

  // ---- contact
  if (ext.link) {
    row.link = normalizeLink(ext.link);
    if (!row.link) warnings.push(`קישור לא תקין הושמט: ${ext.link}`);
  }
  const phones = (ext.phones || []).map(normalizePhone);
  const bad = (ext.phones || []).filter((_, i) => !phones[i]);
  if (bad.length) warnings.push(`טלפון לא תקין: ${bad.join(", ")}`);
  const good = phones.filter(Boolean);
  row.phone = good.find(isMobile) || good[0] || null; // prefer a mobile: only 05X gets the WhatsApp button
  if (row.phone && !isMobile(row.phone)) warnings.push("טלפון קווי — בלי כפתור וואטסאפ");
  if (good.length > 1) warnings.push(`טלפונים נוספים: ${good.filter((p) => p !== row.phone).join(", ")}`);

  return { row, exceptions: skip.map((d) => ({ on_date: d, kind: "skip" })), warnings, errors };
}

/** DB check constraints, mirrored so the card can block approve before Supabase rejects it. */
export function validateRow(row) {
  const errs = [];
  if (!row.date_start) errs.push("אין תאריך התחלה");
  if (row.date_end && row.date_start && row.date_end < row.date_start) errs.push("date_end < date_start");
  if (row.price_min != null && row.price_max != null && row.price_max < row.price_min) errs.push("price_max < price_min");
  if (!["he", "en"].includes(row.language)) errs.push("שפה");
  if (row.link && !LINK_RE.test(row.link)) errs.push("קישור לא תקין");
  if (row.phone && !PHONE_RE.test(row.phone)) errs.push("טלפון לא תקין");
  if (row.rule_interval_weeks != null && (row.rule_interval_weeks < 1 || row.rule_interval_weeks > 4)) errs.push("מרווח שבועות");
  if (row.status === "live") {
    if (!row.disciplines?.length) errs.push("חסר סוג תנועה");
    if (!row.link && !row.phone) errs.push("חסר קישור או טלפון");
  }
  return errs;
}

const SCHEDULE_FIELDS = ["date_start", "date_end", "rule_weekdays", "rule_interval_weeks", "valid_until", "time_start", "time_end"];
const FILL_FIELDS = ["price_raw", "price_kind", "price_min", "price_max", "price_unit", "link", "phone", "description"];

/**
 * Patch for updating an existing event from newer text (proposal for decision E3):
 * - schedule fields move together (the new text describes the new dates);
 * - price/link/phone/description: overwrite only when the new text has a value;
 * - disciplines/formats/audience: union;
 * - title, venue, hosts: never changed by an update.
 * Returns { patch, changes:[{field, from, to}] }.
 */
export function buildUpdate(existing, row) {
  const patch = {};
  const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const f of SCHEDULE_FIELDS) {
    const from = f.startsWith("time_") ? hhmm(existing[f]) : existing[f];
    if (!same(from, row[f])) patch[f] = row[f];
  }
  for (const f of FILL_FIELDS) if (row[f] != null && !same(existing[f], row[f])) patch[f] = row[f];
  for (const f of ["disciplines", "formats", "audience"]) {
    const u = uniq([...(existing[f] || []), ...(row[f] || [])]);
    if (u.length !== (existing[f] || []).length) patch[f] = u;
  }
  const changes = Object.keys(patch).map((f) => ({ field: f, from: existing[f] ?? null, to: patch[f] }));
  return { patch, changes };
}
