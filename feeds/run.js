// One feed run: a source's items → the bot's own pipeline (mapping, venue/host matching, duplicate check)
// → publish, or leave for the owner. Rules (rebuild plan): a feed only fills blanks and never overwrites
// an edit; anything it isn't sure about is skipped and reported, never guessed. Nothing is ever deleted.
// dryRun = nothing is written to events; the report says what would happen.
import { loadLookups, loadWorld } from "../bot/db.js";
import { buildItem, questions, blockers } from "../bot/proposal.js";
import { approveItem } from "../bot/write.js";
import { normalizeLink, todayIL, addDays, weekday } from "../bot/normalize.js";

// Fields a feed may fill on an event it already published (or one added by hand), only while empty.
// Not valid_until: on a weekly event null means "ongoing", the owner's choice, not a blank. Filling it with
// an estimate would end the event; a different end date is reported (COMPARE) instead.
const FILL_IF_EMPTY = ["time_start", "time_end", "price_raw", "price_kind", "price_min", "price_max", "price_unit", "phone", "description"];
// Compared and reported, never changed: the owner's version wins.
const COMPARE = ["date_start", "date_end", "valid_until", "rule_weekdays", "time_start", "time_end"];

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const val = (f, v) => (f.startsWith("time_") ? hhmm(v) : v ?? null);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The existing event this item is: same link (the source's own page for it). */
export function ownEvent(item, events) {
  const link = normalizeLink(item.row.link || "");
  if (!link) return null;
  return events.find((e) => e.link && normalizeLink(e.link) === link) || null;
}

/** Existing events at the same venue that meet on the same weekday and start within a week: maybe the same course. */
export function nearSlot(row, venueId, events) {
  if (!venueId || !row.date_start) return [];
  const days = (r) => (r.rule_weekdays?.length ? r.rule_weekdays : [weekday(r.date_start)]);
  const lo = addDays(row.date_start, -7), hi = addDays(row.date_start, 7);
  return events.filter((e) => e.venue_id === venueId && e.date_start && e.date_start >= lo && e.date_start <= hi
    && days(e).some((d) => days(row).includes(d)));
}

/** Fill-blanks patch for an existing event, plus the schedule differences the owner should see. */
export function fillBlanks(existing, row) {
  const patch = {};
  for (const f of FILL_IF_EMPTY) if (existing[f] == null && row[f] != null) patch[f] = row[f];
  const diffs = COMPARE.filter((f) => existing[f] != null && row[f] != null && !same(val(f, existing[f]), val(f, row[f])))
    .map((f) => ({ field: f, site: val(f, existing[f]), source: val(f, row[f]) }));
  return { patch, diffs };
}

const venueOf = (item) => item.venue.candidates.find((c) => c.id === item.venue.chosen)?.name || item.venue.name || null;

/**
 * @param adapter { source, fetchItems(fetchImpl) → [{ key, source_title, ext }] }
 * @returns report { source, dry_run, today, fetched, items:[…], counts }
 */
export async function runFeed(adapter, { sb, dryRun = true, today = todayIL(), fetchImpl = fetch } = {}) {
  const report = { source: adapter.source, dry_run: dryRun, today, fetched: 0, items: [], counts: {} };
  const raw = await adapter.fetchItems(fetchImpl);
  report.fetched = raw.length;
  const [lk, world, linked] = await Promise.all([loadLookups(sb), loadWorld(sb, today), sb.all("events?select=id,title,status,link&link=not.is.null")]);

  for (const [i, r] of raw.entries()) {
    const out = { key: r.key, source_title: r.source_title, link: r.ext?.link || null };
    report.items.push(out);
    if (!r.ext) { Object.assign(out, { action: "skip", reason: r.skip || "לא פוענח" }); continue; }

    const item = buildItem(r.ext, i, world, lk, today);
    Object.assign(out, { title: item.row.title, date_start: item.row.date_start, time: [hhmm(item.row.time_start), hhmm(item.row.time_end)].filter(Boolean).join("–") || null, venue: venueOf(item), warnings: item.warnings });
    const last = item.row.rule_weekdays ? item.row.valid_until : item.row.date_end || item.row.date_start;
    if (last && last < today) { Object.assign(out, { action: "skip", reason: "כבר עבר" }); continue; }

    // Every status counts here: an event the owner rejected or hid must not come back the next morning.
    const any = ownEvent(item, linked);
    if (any && any.status !== "live") { Object.assign(out, { action: "skip", event_id: any.id, reason: `כבר קיים באתר בסטטוס ${any.status} — לא נוגע` }); continue; }
    const own = any && (world.events.find((e) => e.id === any.id) || null);
    if (any && !own) { Object.assign(out, { action: "unchanged", event_id: any.id, site_title: any.title }); continue; }
    if (own) {
      const { patch, diffs } = fillBlanks(own, item.row);
      Object.assign(out, { event_id: own.id, site_title: own.title, fill: patch, diffs });
      out.action = Object.keys(patch).length ? "update" : "unchanged";
      if (!dryRun) await sb.update(`events?id=eq.${own.id}`, { ...patch, last_verified: today });
      continue;
    }

    const why = [];
    const near = nearSlot(item.row, item.venue.chosen, world.events);
    // Same title at the same venue but on other dates = the next cycle of a course, not a duplicate.
    const sameish = item.dup.candidates.filter((c) => c.reason !== "same_venue_title_other_dates");
    if (!sameish.length && item.dup.chosen === undefined) item.dup.chosen = "new";
    const dups = [...new Map([...sameish.map((c) => [c.id, c.title]), ...near.map((e) => [e.id, e.title])]).entries()];
    if (dups.length) why.push(`אולי כבר קיים: ${dups.map(([, t]) => t).join(" / ")}`);
    if (item.venue.chosen === undefined || item.venue.chosen === "new") why.push(`מקום לא מוכר: ${item.venue.name || "לא צוין"}`);
    if (item.hosts.some((h) => h.chosen !== undefined && h.chosen === "new")) why.push(`מנחה חדש: ${item.hosts.filter((h) => h.chosen === "new").map((h) => h.name).join(", ")}`);
    if (!dups.length) why.push(...questions(item).filter((q) => q.key !== "venue").map((q) => q.text), ...blockers(item).filter((b) => b !== "יש שאלות פתוחות"));
    if (why.length) { Object.assign(out, { action: "skip", reason: [...new Set(why)].join(" · ") }); continue; }

    out.action = "insert";
    if (!dryRun) {
      try { out.event_id = (await approveItem(sb, { items: [item] }, item, lk, today)).event_id; }
      catch (e) { Object.assign(out, { action: "error", reason: e.message }); }
    }
  }
  for (const it of report.items) report.counts[it.action] = (report.counts[it.action] || 0) + 1;
  return report;
}

/** Keep a record of the run (table from v2/db/2026-10-14-feed-runs.sql). A missing table doesn't fail the run. */
export async function saveRun(sb, report, error) {
  try {
    await sb.insert("feed_runs", [{ source: report?.source, dry_run: report?.dry_run ?? true, ok: !error, counts: report?.counts || {}, report: report || null, error: error ? String(error.message || error) : null }], { returning: false });
    return true;
  } catch (e) {
    console.error("zuzu feeds: could not save run", e.message);
    return false;
  }
}
