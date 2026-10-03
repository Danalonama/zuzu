// Approve → write to Supabase. PostgREST has no multi-request transactions, so on a failure after
// the event row exists we delete what this call created (event_hosts, exceptions, the event).
import { finalPlan, blockers } from "./proposal.js";
import { buildUpdate, validateRow } from "./map.js";
import { EVENT_COLS } from "./db.js";
import { norm } from "./normalize.js";

export class ApproveError extends Error {}

async function resolveVenue(sb, item, lk) {
  const v = item.venue;
  if (v.chosen !== "new") return null;
  // Last check against a race / an alias added since the card was built.
  const existing = await sb.all("venues?select=id,name,aliases");
  const hit = existing.find((x) => [x.name, ...(x.aliases || [])].some((n) => norm(n) === norm(v.name)));
  if (hit) return hit.id;
  const kind = process.env.NEW_VENUE_KIND || (lk.venueKinds?.includes("studio") ? "studio" : undefined);
  const [row] = await sb.insert("venues", [{ name: v.name.trim(), city_id: v.city_id, ...(kind ? { kind } : {}) }]);
  v.chosen = row.id;
  v.candidates.unshift({ id: row.id, name: row.name, city: v.city_name, score: 1 });
  return row.id;
}

async function resolveHosts(sb, item, lk) {
  const ids = [];
  for (const h of item.hosts) {
    if (h.chosen && h.chosen !== "new") { ids.push(h.chosen); continue; }
    const same = await sb.get(`hosts?select=id&name=eq.${encodeURIComponent(h.name)}`);
    if (same.length) { h.chosen = same[0].id; ids.push(same[0].id); continue; }
    const kind = lk.hostKinds?.includes(h.kind) ? h.kind : undefined;
    const [row] = await sb.insert("hosts", [{ name: h.name, ...(kind ? { kind } : {}) }]);
    h.chosen = row.id;
    h.candidates.unshift({ id: row.id, name: row.name, score: 1 });
    ids.push(row.id);
  }
  return [...new Set(ids)];
}

/**
 * @returns { action, event_id, changes? }
 * Mutates `item` (chosen ids, state, result). Caller persists the draft.
 */
export async function approveItem(sb, draft, item, lk, today) {
  const blocked = blockers(item);
  if (blocked.length) throw new ApproveError(blocked.join(" · "));

  let parent_id = null;
  if (item.parent_index != null) {
    const parent = draft.items[item.parent_index];
    if (!parent || parent.state !== "approved" || !parent.result?.event_id) {
      throw new ApproveError(`קודם לאשר את אירוע ${item.parent_index + 1} (האירוע הראשי)`);
    }
    parent_id = parent.result.event_id;
  }

  const venue_id = await resolveVenue(sb, item, lk);
  const hostIds = await resolveHosts(sb, item, lk);
  const plan = finalPlan(item);

  if (plan.action === "update") {
    const [current] = await sb.get(`events?select=${EVENT_COLS}&id=eq.${plan.event_id}`);
    if (!current) throw new ApproveError("האירוע הקיים נמחק בינתיים");
    const { patch, changes } = buildUpdate(current, { ...item.row, venue_id: current.venue_id });
    const errs = validateRow({ ...current, ...patch });
    if (errs.length) throw new ApproveError(errs.join(" · "));
    await sb.update(`events?id=eq.${current.id}`, { ...patch, last_verified: today });
    const linked = await sb.get(`event_hosts?select=host_id&event_id=eq.${current.id}`);
    const addHosts = hostIds.filter((h) => !linked.some((l) => l.host_id === h));
    if (addHosts.length) await sb.insert("event_hosts", addHosts.map((host_id) => ({ event_id: current.id, host_id })), { returning: false });
    const have = await sb.get(`event_exceptions?select=on_date&event_id=eq.${current.id}`);
    const addEx = item.exceptions.filter((x) => !have.some((h) => String(h.on_date).slice(0, 10) === x.on_date));
    if (addEx.length) await sb.insert("event_exceptions", addEx.map((x) => ({ ...x, event_id: current.id })), { returning: false });
    item.state = "approved";
    item.result = { action: "update", event_id: current.id, changes };
    return item.result;
  }

  const row = { ...plan.row, parent_id };
  if (venue_id) row.venue_id = venue_id;
  let created;
  try {
    [created] = await sb.insert("events", [row]);
  } catch (e) {
    if (e.code === "23505") throw new ApproveError("כבר קיים אירוע עם אותו תאריך, כותרת ומקום (canonical_key)");
    if (e.code === "23514") throw new ApproveError(`הנתונים לא עוברים בדיקה בבסיס הנתונים: ${e.body?.message || ""}`);
    throw e;
  }
  try {
    if (hostIds.length) await sb.insert("event_hosts", hostIds.map((host_id) => ({ event_id: created.id, host_id })), { returning: false });
    if (item.exceptions.length) await sb.insert("event_exceptions", item.exceptions.map((x) => ({ ...x, event_id: created.id })), { returning: false });
  } catch (e) {
    await sb.del(`event_hosts?event_id=eq.${created.id}`).catch(() => {});
    await sb.del(`event_exceptions?event_id=eq.${created.id}`).catch(() => {});
    await sb.del(`events?id=eq.${created.id}`).catch(() => {});
    throw e;
  }
  item.state = "approved";
  item.result = { action: "insert", event_id: created.id };
  return item.result;
}
