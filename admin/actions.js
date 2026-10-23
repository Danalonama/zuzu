// Editing page (edit.html) → Supabase, through the service key. Every write is checked here first:
// only listed fields, normalized the way the bot does it (bot/normalize.js), and the same DB checks
// (bot/map.js validateRow). Nothing is ever deleted except a skipped date or a host link of an event.
import { validateRow } from "../bot/map.js";
import { norm, normalizePhone, normalizeLink, normalizeTime, parseIso, ISO_DATE } from "../bot/normalize.js";

export class AdminError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const EVENT_FIELDS = [
  "title", "title_en", "language", "status", "description", "disciplines", "formats", "audience",
  "venue_id", "location_on_registration", "date_start", "date_end", "time_start", "time_end",
  "rule_weekdays", "rule_interval_weeks", "valid_until",
  "price_raw", "price_kind", "price_min", "price_max", "price_unit", "link", "phone",
];
const VENUE_FIELDS = ["name", "aliases", "kind", "city_id", "address", "url"];
const HOST_FIELDS = ["name", "aliases", "kind", "phone", "url"];

const uniq = (a) => [...new Set(a)];
const text = (v) => (v == null ? null : String(v).trim() || null);
const enc = encodeURIComponent;

async function enumValues(sb, tbl, col) {
  try {
    const v = await sb.rpc("intake_column_enum", { tbl, col });
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

/** Everything the page needs, in one call. */
export async function load(sb) {
  const [events, eventHosts, exceptions, venues, hosts, cities, regions, disciplines, formats] = await Promise.all([
    sb.all("events?select=*&order=date_start.desc"),
    sb.all("event_hosts?select=event_id,host_id"),
    sb.all("event_exceptions?select=*&order=on_date"),
    sb.all("venues?select=*&order=name"),
    sb.all("hosts?select=*&order=name"),
    sb.all("cities?select=id,name,aliases,region_id&order=name"),
    sb.get("regions?select=id,slug,name_he,sort_order&order=sort_order"),
    sb.get("disciplines?select=slug,label_he&order=label_he"),
    sb.get("formats?select=slug,label_he&order=label_he"),
  ]);
  const byEvent = (rows) => rows.reduce((m, r) => ((m[r.event_id] = m[r.event_id] || []).push(r), m), {});
  const hostsOf = byEvent(eventHosts), exOf = byEvent(exceptions);
  return {
    events: events.map((e) => ({ ...e, host_ids: (hostsOf[e.id] || []).map((h) => h.host_id), exceptions: exOf[e.id] || [] })),
    venues, hosts, cities, regions, disciplines, formats,
    enums: await loadEnums(sb),
  };
}

const ENUMS = [["status", "events", "status"], ["price_kind", "events", "price_kind"], ["price_unit", "events", "price_unit"],
  ["audience", "events", "audience"], ["host_kind", "hosts", "kind"], ["venue_kind", "venues", "kind"], ["exception_kind", "event_exceptions", "kind"]];

/** Allowed values per column: the real enum labels; for a plain-text column, the values already in use. */
export async function loadEnums(sb) {
  const vals = await Promise.all(ENUMS.map(([, t, c]) => enumValues(sb, t, c)));
  const out = {};
  for (const [i, [k, t, c]] of ENUMS.entries()) {
    if (vals[i]) { out[k] = vals[i]; continue; }
    const rows = await sb.all(`${t}?select=${c}`);
    const base = { status: ["live"], exception_kind: ["skip"] }[k] || []; // the values the bot itself writes
    out[k] = uniq([...base, ...rows.flatMap((r) => [].concat(r[c] ?? []))]).filter(Boolean).sort();
  }
  return out;
}

// ---------- events

function isoOrNull(v, label, errs) {
  const s = text(v);
  if (s == null) return null;
  if (!ISO_DATE.test(s) || !parseIso(s)) { errs.push(`${label}: תאריך לא תקין`); return null; }
  return s;
}

function cleanEventPatch(patch, lk) {
  const out = {}, errs = [];
  for (const [f, v] of Object.entries(patch || {})) {
    if (!EVENT_FIELDS.includes(f)) throw new AdminError(`שדה לא מוכר: ${f}`);
    switch (f) {
      case "title": out.title = text(v); if (!out.title) errs.push("אין כותרת"); break;
      case "title_en": case "description": case "price_raw": out[f] = text(v); break;
      case "language": out.language = v; break;
      case "status": if (!lk.enums.status.includes(v)) errs.push(`סטטוס לא מוכר: ${v}`); out.status = v; break;
      case "disciplines": {
        const known = new Set(lk.disciplines.map((d) => d.slug));
        out.disciplines = uniq((v || []).filter((s) => known.has(s))); break;
      }
      case "formats": {
        const known = new Set(lk.formats.map((d) => d.slug));
        out.formats = uniq((v || []).filter((s) => known.has(s))); break;
      }
      case "audience": out.audience = uniq((v || []).filter((s) => lk.enums.audience.includes(s))); break;
      case "venue_id":
        out.venue_id = v || null;
        if (out.venue_id && !lk.venues.some((x) => x.id === out.venue_id)) errs.push("מקום לא קיים");
        break;
      case "location_on_registration": out[f] = !!v; break;
      case "date_start": case "date_end": case "valid_until":
        out[f] = isoOrNull(v, { date_start: "תאריך התחלה", date_end: "תאריך סיום", valid_until: "עד תאריך" }[f], errs); break;
      case "time_start": case "time_end": {
        const s = text(v);
        out[f] = s ? normalizeTime(s) : null;
        if (s && !out[f]) errs.push(`שעה לא תקינה: ${s}`);
        break;
      }
      case "rule_weekdays":
        out.rule_weekdays = v == null || !v.length ? null : uniq(v.map(Number)).sort();
        if (out.rule_weekdays?.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errs.push("יום בשבוע לא תקין");
        break;
      case "rule_interval_weeks": out[f] = v == null || v === "" ? null : Number(v); break;
      case "price_min": case "price_max":
        out[f] = v == null || v === "" ? null : Number(v);
        if (out[f] != null && !Number.isFinite(out[f])) errs.push("מחיר לא מספר");
        break;
      case "price_kind": case "price_unit": {
        const list = lk.enums[f];
        out[f] = v || null;
        if (out[f] && !list.includes(out[f])) errs.push(`ערך לא מוכר: ${out[f]}`);
        break;
      }
      case "link": {
        const s = text(v);
        out.link = s ? normalizeLink(s) : null;
        if (s && !out.link) errs.push(`קישור לא תקין: ${s}`);
        break;
      }
      case "phone": {
        const s = text(v);
        out.phone = s ? normalizePhone(s) : null;
        if (s && !out.phone) errs.push(`טלפון לא תקין: ${s}`);
        break;
      }
    }
  }
  return { patch: out, errs };
}

function scheduleErrors(row) {
  const errs = [];
  if (row.rule_weekdays?.length) {
    if (row.valid_until && row.date_start && row.valid_until < row.date_start) errs.push("'עד תאריך' לפני תאריך ההתחלה");
  }
  return errs;
}

const eventPayload = async (sb, id) => {
  const [e] = await sb.get(`events?select=*&id=eq.${enc(id)}`);
  if (!e) return null;
  const [hosts, exceptions] = await Promise.all([
    sb.get(`event_hosts?select=event_id,host_id&event_id=eq.${enc(id)}`),
    sb.get(`event_exceptions?select=*&event_id=eq.${enc(id)}&order=on_date`),
  ]);
  return { ...e, host_ids: hosts.map((h) => h.host_id), exceptions };
};

function dbError(e) {
  if (e.code === "23505") return new AdminError("כבר קיים אירוע עם אותו תאריך, כותרת ומקום");
  if (e.code === "23514" || e.code === "22P02" || e.code === "23502") return new AdminError(`בסיס הנתונים דחה את השמירה: ${e.body?.message || e.message}`);
  return e;
}

/**
 * Save one event. `updated_at` is the version the page saw: if someone (the bot, a feed) changed the
 * event since, nothing is written and the current version comes back (409).
 */
export async function saveEvent(sb, lk, { id, updated_at, patch = {}, host_ids }) {
  if (!id) throw new AdminError("חסר מזהה אירוע");
  const [current] = await sb.get(`events?select=*&id=eq.${enc(id)}`);
  if (!current) throw new AdminError("האירוע לא נמצא", 404);
  if (updated_at && current.updated_at !== updated_at) {
    throw new AdminError("האירוע השתנה מאז שנפתח (הבוט או הזנה). הגרסה העדכנית נטענה — לבדוק ולשמור שוב.", 409, { current: await eventPayload(sb, id) });
  }
  const { patch: clean, errs } = cleanEventPatch(patch, lk);
  const merged = { ...current, ...clean };
  errs.push(...validateRow(merged), ...scheduleErrors(merged));
  if (host_ids && host_ids.some((h) => !lk.hosts.some((x) => x.id === h))) errs.push("מנחה לא קיים");
  if (errs.length) throw new AdminError(uniq(errs).join(" · "));

  if (Object.keys(clean).length) {
    const stamp = new Date().toISOString();
    let rows;
    try {
      rows = await sb.update(`events?id=eq.${enc(id)}&updated_at=eq.${enc(current.updated_at)}`, { ...clean, updated_at: stamp });
    } catch (e) { throw dbError(e); }
    if (!rows.length) throw new AdminError("האירוע השתנה בדיוק עכשיו. הגרסה העדכנית נטענה — לשמור שוב.", 409, { current: await eventPayload(sb, id) });
  }
  if (host_ids) {
    const want = uniq(host_ids);
    const have = (await sb.get(`event_hosts?select=host_id&event_id=eq.${enc(id)}`)).map((h) => h.host_id);
    const add = want.filter((h) => !have.includes(h)), drop = have.filter((h) => !want.includes(h));
    if (add.length) await sb.insert("event_hosts", add.map((host_id) => ({ event_id: id, host_id })), { returning: false });
    for (const h of drop) await sb.del(`event_hosts?event_id=eq.${enc(id)}&host_id=eq.${enc(h)}`);
  }
  return eventPayload(sb, id);
}

export async function addException(sb, lk, { event_id, on_date, kind, override_host_id, note }) {
  const errs = [];
  const d = isoOrNull(on_date, "תאריך", errs);
  if (!d) errs.push("חסר תאריך");
  if (!lk.enums.exception_kind.includes(kind)) errs.push(`סוג לא מוכר: ${kind}`);
  if (kind === "override" && !lk.hosts.some((h) => h.id === override_host_id)) errs.push("להחלפת מנחה צריך לבחור מנחה");
  if (errs.length) throw new AdminError(errs.join(" · "));
  const [ev] = await sb.get(`events?select=id&id=eq.${enc(event_id)}`);
  if (!ev) throw new AdminError("האירוע לא נמצא", 404);
  const have = await sb.get(`event_exceptions?select=on_date&event_id=eq.${enc(event_id)}&on_date=eq.${d}`);
  if (have.length) throw new AdminError("כבר יש שינוי בתאריך הזה — להסיר אותו קודם");
  const row = { event_id, on_date: d, kind, note: text(note) };
  if (kind === "override") row.override_host_id = override_host_id;
  try { await sb.insert("event_exceptions", [row], { returning: false }); } catch (e) { throw dbError(e); }
  return eventPayload(sb, event_id);
}

export async function removeException(sb, { event_id, on_date }) {
  if (!event_id || !ISO_DATE.test(on_date || "")) throw new AdminError("חסר אירוע או תאריך");
  await sb.del(`event_exceptions?event_id=eq.${enc(event_id)}&on_date=eq.${on_date}`);
  return eventPayload(sb, event_id);
}

// ---------- venues and hosts

function cleanAliases(list, name) {
  const seen = new Set([norm(name)]);
  const out = [];
  for (const a of (Array.isArray(list) ? list : String(list || "").split(",")).map((s) => String(s).trim()).filter(Boolean)) {
    const k = norm(a);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(a);
  }
  return out;
}

/** Another row already called this (by name or alias)? The bot matches on both, so two would collide. */
function clash(rows, id, names) {
  const want = new Set(names.map(norm).filter(Boolean));
  return rows.find((r) => r.id !== id && [r.name, ...(r.aliases || [])].some((n) => want.has(norm(n))));
}

function cleanPlacePatch(patch, fields, kinds, lk) {
  const out = {};
  for (const [f, v] of Object.entries(patch || {})) {
    if (!fields.includes(f)) throw new AdminError(`שדה לא מוכר: ${f}`);
    if (f === "aliases") out.aliases = v;
    else if (f === "kind") { out.kind = v || null; if (out.kind && !kinds.includes(out.kind)) throw new AdminError(`סוג לא מוכר: ${out.kind}`); }
    else if (f === "city_id") { out.city_id = v == null || v === "" ? null : Number(v); if (out.city_id != null && !lk.cities.some((c) => c.id === out.city_id)) throw new AdminError("עיר לא קיימת"); }
    else if (f === "url") { const s = text(v); out.url = s ? normalizeLink(s) : null; if (s && !out.url) throw new AdminError(`קישור לא תקין: ${s}`); }
    else if (f === "phone") { const s = text(v); out.phone = s ? normalizePhone(s) : null; if (s && !out.phone) throw new AdminError(`טלפון לא תקין: ${s}`); }
    else out[f] = text(v);
  }
  return out;
}

async function savePlace(sb, lk, table, { id, patch, keep_old_name = true }, create) {
  const isVenue = table === "venues";
  const rows = isVenue ? lk.venues : lk.hosts;
  const clean = cleanPlacePatch(patch, isVenue ? VENUE_FIELDS : HOST_FIELDS, isVenue ? lk.enums.venue_kind : lk.enums.host_kind, lk);
  let current = null;
  if (!create) {
    [current] = await sb.get(`${table}?select=*&id=eq.${enc(id)}`);
    if (!current) throw new AdminError("לא נמצא", 404);
  }
  const name = "name" in clean ? clean.name : current?.name;
  if (!name) throw new AdminError("חסר שם");
  let aliases = "aliases" in clean ? clean.aliases : current?.aliases || [];
  // A rename keeps the old spelling as an alias, so the bot and the feeds still recognise it.
  if (current && name !== current.name && keep_old_name) aliases = [...(Array.isArray(aliases) ? aliases : String(aliases).split(",")), current.name];
  clean.name = name;
  clean.aliases = cleanAliases(aliases, name);
  const other = clash(rows, current?.id, [name, ...clean.aliases]);
  if (other) throw new AdminError(`השם או אחד הכינויים כבר שייכים ל"${other.name}". לאחד ידנית ב-Supabase, לא מכאן.`);
  try {
    if (create) return (await sb.insert(table, [clean]))[0];
    const [row] = await sb.update(`${table}?id=eq.${enc(id)}`, clean);
    return row;
  } catch (e) { throw dbError(e); }
}

export const saveVenue = (sb, lk, args) => savePlace(sb, lk, "venues", args, false);
export const createVenue = (sb, lk, args) => savePlace(sb, lk, "venues", { patch: args }, true);
export const saveHost = (sb, lk, args) => savePlace(sb, lk, "hosts", args, false);
export const createHost = (sb, lk, args) => savePlace(sb, lk, "hosts", { patch: args }, true);

/** What the checks need, without the events. */
export async function lookups(sb) {
  const [venues, hosts, cities, disciplines, formats, enums] = await Promise.all([
    sb.all("venues?select=id,name,aliases"), sb.all("hosts?select=id,name,aliases"), sb.all("cities?select=id,name"),
    sb.get("disciplines?select=slug"), sb.get("formats?select=slug"), loadEnums(sb),
  ]);
  return { venues, hosts, cities, disciplines, formats, enums };
}

export const ACTIONS = {
  "event.save": saveEvent,
  "exception.add": addException,
  "exception.remove": (sb, lk, args) => removeException(sb, args),
  "venue.save": saveVenue,
  "venue.create": createVenue,
  "host.save": saveHost,
  "host.create": createHost,
};
