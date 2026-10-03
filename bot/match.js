// Match extracted names against what's already in Supabase. Pure: takes lists, returns scored candidates.
// Nothing here decides to create or merge — it only produces candidates and questions for the card.
import { nameScore, norm, parseIso, weekday } from "./normalize.js";

// Thresholds (decision F in docs/zuzu-v2-data-model-questions.md — tune with the owner).
export const T = {
  venueAuto: 0.92,   // ≥ this: matched, shown on the card with ✓
  venueAsk: 0.55,    // ≥ this: offered as a candidate button
  cityMatch: 0.85,
  hostAuto: 0.95,
  hostAsk: 0.72,
  eventSameVenueTitle: 0.5,  // same venue + title this similar → "same event?"
  eventAnyVenueTitle: 0.8,   // different/unknown venue: title must be this similar and dates overlap
};

const bestOf = (name, names, opts) => Math.max(0, ...names.filter(Boolean).map((n) => nameScore(name, n, opts)));

export function matchCity(cityName, cities) {
  if (!cityName) return null;
  let best = null;
  for (const c of cities) {
    const s = bestOf(cityName, [c.name, ...(c.aliases || [])]);
    if (s >= T.cityMatch && (!best || s > best.score)) best = { city: c, score: s };
  }
  return best;
}

/**
 * Venue candidates for an extracted venue name (+ optional city), best first.
 * Also tries "venue + city" against the name, since many venue names embed the town ("TEO הרצליה").
 */
export function matchVenue({ venue_name, city }, venues, cities) {
  if (!venue_name) return { status: "none", candidates: [] };
  const cityHit = matchCity(city, cities);
  const cands = [];
  for (const v of venues) {
    const names = [v.name, ...(v.aliases || [])];
    let s = bestOf(venue_name, names, { stop: true });
    if (city) s = Math.max(s, bestOf(`${venue_name} ${city}`, names, { stop: true }));
    if (cityHit && v.city_id) {
      if (v.city_id === cityHit.city.id) s = Math.min(1, s + 0.05);
      else s -= 0.15; // same name in another town is probably another place
    }
    if (s >= T.venueAsk) cands.push({ venue: v, score: Math.round(s * 100) / 100 });
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands[0];
  const clear = top && top.score >= T.venueAuto && (!cands[1] || cands[1].score < top.score - 0.05);
  return { status: clear ? "matched" : cands.length ? "ambiguous" : "unknown", candidates: cands.slice(0, 3), city: cityHit?.city || null };
}

export function matchHost(name, hosts) {
  const cands = [];
  for (const h of hosts) {
    const s = bestOf(name, [h.name, ...(h.aliases || [])]);
    if (s >= T.hostAsk) cands.push({ host: h, score: Math.round(s * 100) / 100 });
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands[0];
  if (top && top.score >= T.hostAuto) return { status: "matched", candidates: [top] };
  return { status: cands.length ? "ambiguous" : "new", candidates: cands.slice(0, 2) };
}

// ---------- existing-event dedup ----------

/** [first, last] date an event can occur on; last = null for open-ended weekly. */
export function eventSpan(e) {
  const weekly = Array.isArray(e.rule_weekdays) && e.rule_weekdays.length > 0;
  if (weekly) {
    const ends = [e.valid_until, e.date_end].filter(Boolean).sort();
    return [e.date_start, ends[0] || null];
  }
  return [e.date_start, e.date_end || e.date_start];
}

function spansOverlap([a1, a2], [b1, b2]) {
  if (!a1 || !b1) return false;
  return (a2 == null || b1 <= a2) && (b2 == null || a1 <= b2);
}

/** Does `e` (existing) meet on any weekday that the proposal `p` meets on? Used for weekly vs weekly. */
function weekdaysMeet(p, e) {
  const pw = p.rule_weekdays?.length ? p.rule_weekdays : p.date_start ? [weekday(p.date_start)] : [];
  const ew = e.rule_weekdays?.length ? e.rule_weekdays : e.date_start && parseIso(e.date_start) ? [weekday(e.date_start)] : [];
  return pw.some((d) => ew.includes(d));
}

/**
 * Existing events that may be the same as proposed row `p` (already mapped to DB columns).
 * Never merges — returns candidates with a reason, for a "same event?" question.
 */
export function findDuplicates(p, existing) {
  const out = [];
  const pSpan = eventSpan(p);
  const pTitle = norm(p.title);
  for (const e of existing) {
    if (e.status === "rejected") continue;
    const titleS = nameScore(pTitle, e.title);
    const sameVenue = p.venue_id && e.venue_id === p.venue_id;
    const overlap = spansOverlap(pSpan, eventSpan(e));
    const sameSlot = overlap && weekdaysMeet(p, e) && p.time_start && e.time_start && String(e.time_start).slice(0, 5) === p.time_start;
    let reason = null;
    if (sameVenue && titleS >= T.eventSameVenueTitle) reason = overlap ? "same_venue_title" : "same_venue_title_other_dates";
    else if (sameVenue && sameSlot) reason = "same_venue_slot";
    else if (titleS >= T.eventAnyVenueTitle && overlap) reason = "same_title_dates";
    if (reason) out.push({ event: e, reason, score: Math.round(titleS * 100) / 100 });
  }
  const rank = { same_venue_title: 0, same_venue_slot: 1, same_title_dates: 2, same_venue_title_other_dates: 3 };
  out.sort((a, b) => rank[a.reason] - rank[b.reason] || b.score - a.score);
  return out.slice(0, 2);
}
