// A proposal = one extracted event + what it matched in the DB + the questions the owner must answer.
// Stored as JSON in intake_drafts.items; the card is rendered from it; approve writes it.
import { mapExtracted, validateRow, buildUpdate } from "./map.js";
import { matchVenue, matchHost, findDuplicates } from "./match.js";

/**
 * @param ext  extracted event
 * @param db   { venues, cities, hosts, events } (events = existing, non-rejected)
 * @param lk   lookups for mapping
 */
export function buildItem(ext, idx, db, lk, today) {
  const m = mapExtracted(ext, lk, today);
  const vm = ext.location_on_registration && !ext.venue_name
    ? { status: "onreg", candidates: [] }
    : matchVenue(ext, db.venues, db.cities);
  const item = {
    idx,
    ext,
    row: m.row,
    exceptions: m.exceptions,
    warnings: m.warnings,
    mapErrors: m.errors,
    venue: {
      status: vm.status, // matched | ambiguous | unknown | none | onreg
      name: ext.venue_name || null,
      city_name: ext.city || null,
      city_id: vm.city?.id || null,
      candidates: vm.candidates.map((c) => ({ id: c.venue.id, name: c.venue.name, city: c.venue.city?.name || null, score: c.score })),
      chosen: vm.status === "matched" ? vm.candidates[0].venue.id : vm.status === "onreg" ? "onreg" : undefined,
    },
    hosts: (ext.hosts || []).filter((h) => h.name?.trim()).map((h) => {
      const hm = matchHost(h.name, db.hosts);
      return {
        name: h.name.trim(),
        kind: h.kind || null,
        status: hm.status, // matched | ambiguous | new
        candidates: hm.candidates.map((c) => ({ id: c.host.id, name: c.host.name, score: c.score })),
        chosen: hm.status === "matched" ? hm.candidates[0].host.id : hm.status === "new" ? "new" : undefined,
      };
    }),
    parent_index: Number.isInteger(ext.parent_index) && ext.parent_index !== idx ? ext.parent_index : null,
    dup: { candidates: [], chosen: undefined },
    state: "pending", // pending | approved | rejected
    card_message_id: null,
    result: null,
  };
  refreshDuplicates(item, db.events);
  return item;
}

/** Venue id to use for dedup/writing, or null. */
export function venueId(item) {
  const c = item.venue.chosen;
  return c && c !== "new" && c !== "onreg" && c !== "none" ? c : null;
}

/** Recompute "same event?" candidates, e.g. after the venue question is answered. */
export function refreshDuplicates(item, events) {
  const probe = { ...item.row, venue_id: venueId(item) };
  const d = findDuplicates(probe, events || []);
  const keep = item.dup?.chosen;
  item.dup = {
    candidates: d.map((c) => ({
      id: c.event.id, title: c.event.title, reason: c.reason, score: c.score,
      date_start: c.event.date_start, date_end: c.event.date_end, valid_until: c.event.valid_until,
      rule_weekdays: c.event.rule_weekdays, time_start: c.event.time_start, status: c.event.status,
      existing: c.event,
    })),
    chosen: keep && (keep === "new" || d.some((c) => c.event.id === keep)) ? keep : d.length ? undefined : "new",
  };
}

/** Open questions, in the order the card shows them. Each option has a short code for callback_data. */
export function questions(item) {
  const qs = [];
  const v = item.venue;
  if (v.chosen === undefined) {
    const opts = v.candidates.map((c, i) => ({ code: `v${i}`, label: `📍 ${c.name}${c.city ? " · " + c.city : ""}` }));
    if (v.name) opts.push({ code: "vn", label: `➕ מקום חדש: ${v.name}` });
    opts.push({ code: "vr", label: "📍 מיקום יימסר בהרשמה" });
    qs.push({ key: "venue", text: v.name ? `איזה מקום זה "${v.name}"?` : "לא צוין מקום", options: opts });
  }
  item.hosts.forEach((h, hi) => {
    if (h.chosen !== undefined) return;
    const opts = h.candidates.map((c, ci) => ({ code: `h${hi}.${ci}`, label: `👤 ${c.name}` }));
    opts.push({ code: `h${hi}.n`, label: `➕ מנחה חדש: ${h.name}` });
    qs.push({ key: `host${hi}`, text: `"${h.name}" — מנחה קיים?`, options: opts });
  });
  if (item.dup.chosen === undefined && item.venue.chosen !== undefined) {
    const opts = item.dup.candidates.map((c, i) => ({ code: `d${i}`, label: `🔄 לעדכן: ${c.title}` }));
    opts.push({ code: "dn", label: "➕ אירוע חדש" });
    qs.push({ key: "dup", text: "אותו אירוע?", options: opts });
  }
  return qs;
}

/** Apply an answer code from a button. Returns true if something changed. */
export function answer(item, code, events) {
  if (code === "vn") item.venue.chosen = "new";
  else if (code === "vr") { item.venue.chosen = "onreg"; }
  else if (/^v\d$/.test(code)) item.venue.chosen = item.venue.candidates[Number(code[1])]?.id;
  else if (/^h\d+\.(n|\d)$/.test(code)) {
    const [hi, ci] = code.slice(1).split(".");
    const h = item.hosts[Number(hi)];
    if (!h) return false;
    h.chosen = ci === "n" ? "new" : h.candidates[Number(ci)]?.id;
  } else if (code === "dn") item.dup.chosen = "new";
  else if (/^d\d$/.test(code)) item.dup.chosen = item.dup.candidates[Number(code[1])]?.id;
  else return false;
  if (code.startsWith("v")) refreshDuplicates(item, events);
  return true;
}

/** The row as it will be written (venue resolved), plus the update patch when merging into an existing event. */
export function finalPlan(item) {
  const row = { ...item.row, venue_id: venueId(item) };
  if (item.venue.chosen === "onreg") { row.location_on_registration = true; row.venue_id = null; }
  const target = item.dup.chosen && item.dup.chosen !== "new" ? item.dup.candidates.find((c) => c.id === item.dup.chosen) : null;
  if (target) {
    const { patch, changes } = buildUpdate(target.existing, row);
    const merged = { ...target.existing, ...patch };
    return { action: "update", event_id: target.id, patch, changes, errors: validateRow(merged) };
  }
  return { action: "insert", row, errors: [...item.mapErrors, ...validateRow(row)] };
}

/** Why approve is blocked right now (empty = can approve). */
export function blockers(item) {
  const out = [];
  if (questions(item).length) out.push("יש שאלות פתוחות");
  if (item.venue.chosen === "new" && !item.venue.city_id) out.push(`עיר לא מוכרת: ${item.venue.city_name || "לא צוינה"} — תקנו עם ✏️`);
  out.push(...finalPlan(item).errors);
  return [...new Set(out)];
}
