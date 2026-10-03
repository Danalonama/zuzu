// Load lookups and the "world" (venues, hosts, existing events) that matching needs.
import { AUDIENCE, FORMATS } from "./map.js";
import { eventSpan } from "./match.js";
import { addDays } from "./normalize.js";

export const EVENT_COLS =
  "id,title,language,status,venue_id,date_start,date_end,valid_until,rule_weekdays,rule_interval_weeks,time_start,time_end," +
  "disciplines,formats,audience,price_raw,price_kind,price_min,price_max,price_unit,link,phone,description,location_on_registration";

async function enumValues(sb, table, column) {
  try {
    const v = await sb.rpc("intake_column_enum", { tbl: table, col: column });
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null; // migration not applied yet: the field is left null rather than guessed
  }
}

export async function loadLookups(sb) {
  const [disciplines, formats, priceKinds, priceUnits, hostKinds, venueKinds, audience] = await Promise.all([
    sb.get("disciplines?select=slug,label_he&order=slug"),
    sb.get("formats?select=slug,label_he&order=slug").catch(() => FORMATS.map((slug) => ({ slug, label_he: slug }))),
    enumValues(sb, "events", "price_kind"),
    enumValues(sb, "events", "price_unit"),
    enumValues(sb, "hosts", "kind"),
    enumValues(sb, "venues", "kind"),
    enumValues(sb, "events", "audience"),
  ]);
  return {
    disciplines,
    formats: formats.map((f) => f.slug),
    audience: audience || AUDIENCE,
    priceKinds, priceUnits, hostKinds, venueKinds,
    discLabel: Object.fromEntries(disciplines.map((d) => [d.slug, d.label_he])),
    fmtLabel: Object.fromEntries(formats.map((f) => [f.slug, f.label_he])),
  };
}

/** Existing events that are still running (or ended in the last month): the only ones that can be "the same event". */
export async function loadEvents(sb, today) {
  const events = await sb.all(`events?select=${EVENT_COLS}&status=neq.rejected&order=id`);
  const horizon = addDays(today, -30);
  return events.filter((e) => { const [, end] = eventSpan(e); return end == null || end >= horizon; });
}

export async function loadWorld(sb, today) {
  const [venues, cities, hosts, events] = await Promise.all([
    sb.all("venues?select=id,name,aliases,kind,city_id,city:cities(id,name)&order=id"),
    sb.all("cities?select=id,name,aliases&order=id"),
    sb.all("hosts?select=id,name,aliases,kind,phone,url&order=id"),
    loadEvents(sb, today),
  ]);
  return { venues, cities, hosts, events };
}
