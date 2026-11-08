// Deep Contact feed: title parsing, and a full run against a fake Supabase (dry and live).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTitle, toItem } from "../deepcontact.js";
import { runFeed, fillBlanks } from "../run.js";
import { summary } from "../notify.js";
import { fakeSupabase } from "../../bot/test/fakes.js";
import { lookups, venues, cities, hosts } from "../../bot/test/fixtures/world.js";

const TODAY = "2026-10-14";
const post = (id, title, link) => ({ id, title: { rendered: title }, link, status: "publish" });

test("the title from the board parses fully", () => {
  const p = parseTitle("קורס יסודות 15.09.2026 ת א ימי שלישי 19:00-21:30");
  assert.equal(p.date, "2026-09-15");
  assert.equal(p.weekday, 2);
  assert.equal(p.time_start, "19:00");
  assert.equal(p.time_end, "21:30");
  assert.equal(p.place.venue, "האחים מסלאוויטה 7");
});

test("place falls back to the page address; HTML entities are decoded", () => {
  const p = parseTitle("סדנת מבוא 2.11.26 &#8211; 10:00-13:00", "https://deepcontact.org/mavo-sharon-page/");
  assert.equal(p.date, "2026-11-02");
  assert.equal(p.place.city, "עדנים");
  assert.equal(p.weekday, null);
});

test("no date or no known place → skipped with a reason, never guessed", () => {
  assert.match(toItem(post(1, "קורס יסודות בקרוב", "https://deepcontact.org/x/"), "yesodot").skip, /אין תאריך/);
  assert.match(toItem(post(2, "קורס יסודות 01.12.2026 חיפה ימי שני 19:00-21:00", "https://deepcontact.org/y/"), "yesodot").skip, /לא ברור איפה/);
});

test("a course becomes a weekly row ending after 3 months; a workshop without a weekday is one date", () => {
  const c = toItem(post(3, "קורס יסודות 05.01.2027 ת א ימי שלישי 19:00-21:30", "https://deepcontact.org/yesodot/tlv-jan/"), "yesodot").ext;
  assert.equal(c.schedule.kind, "weekly");
  assert.deepEqual(c.schedule.weekdays, [2]);
  assert.equal(c.schedule.valid_until, "2027-04-06");
  assert.deepEqual(c.formats, ["course"]);
  const w = toItem(post(4, "סדנת מבוא 20.11.2026 ת\"א 10:00-13:00", "https://deepcontact.org/mavoyesodot/w/"), "mavoyesodot").ext;
  assert.equal(w.schedule.kind, "once");
  assert.deepEqual(w.formats, ["workshop"]);
});

test("fillBlanks only fills empty fields and reports schedule differences", () => {
  const existing = { time_start: "21:30:00", time_end: "19:00:00", price_raw: null, valid_until: "2026-12-29", date_start: "2026-09-15" };
  const row = { time_start: "19:00", time_end: "21:30", price_raw: "1,200 ₪", valid_until: "2026-12-15", date_start: "2026-09-15" };
  const { patch, diffs } = fillBlanks(existing, row);
  assert.deepEqual(patch, { price_raw: "1,200 ₪" });
  assert.deepEqual(diffs.map((d) => d.field).sort(), ["time_end", "time_start", "valid_until"]);
});

test("an ongoing weekly event (no end date) is never given one", () => {
  const { patch } = fillBlanks({ rule_weekdays: [2], valid_until: null, time_start: "19:00:00" }, { rule_weekdays: [2], valid_until: "2027-04-06", time_start: "19:00" });
  assert.equal("valid_until" in patch, false);
});

// ---- full run
const DC_HOST = { id: "h-dc", name: "Deep Contact", aliases: [], kind: "org" };
const existingTue = {
  id: "e-tue", title: "Deep Contact — קורס מבוא בקונטקט אימפרוביזציה (14 מפגשים, ימי שלישי)", language: "he", status: "live",
  venue_id: "v-masl", date_start: "2026-09-15", date_end: null, valid_until: "2026-12-29", rule_weekdays: [2], rule_interval_weeks: 1,
  time_start: "21:30:00", time_end: "19:00:00", disciplines: ["contact"], formats: ["course"], audience: [],
  link: "https://deepcontact.org/yesodot/yesodot_tlv_tue/", phone: "050-3010073", price_raw: null, description: null,
};
const handAddedSun = { ...existingTue, id: "e-sun", title: "קורס קונטקט ימי ראשון", link: "https://deepcontact.org/courses_workshops/", rule_weekdays: [0], date_start: "2026-11-08", valid_until: "2027-02-06", time_start: "19:00:00", time_end: null };
const POSTS = [
  post(10, "קורס יסודות 15.09.2026 ת א ימי שלישי 19:00-21:30", "https://deepcontact.org/yesodot/yesodot_tlv_tue/"),   // already on the site
  post(11, "קורס יסודות 05.01.2027 ת א ימי שלישי 19:00-21:30", "https://deepcontact.org/yesodot/yesodot_tlv_tue_jan/"), // next cycle
  post(12, "קורס יסודות 09.11.2026 ת א ימי ראשון 19:00-21:30", "https://deepcontact.org/yesodot/tlv_sun/"),              // hand-added under another link
  post(13, "קורס יסודות 01.12.2026 חיפה ימי שני 19:00-21:00", "https://deepcontact.org/yesodot/haifa/"),                 // unknown place
  post(14, "סדנת מבוא 01.10.2026 ת א 10:00-13:00", "https://deepcontact.org/mavoyesodot/old/"),                          // already past
];
const adapter = { source: "deepcontact", fetchItems: async () => POSTS.map((p) => toItem(p, p.id === 14 ? "mavoyesodot" : "yesodot")) };
const seed = () => ({
  venues, cities, hosts: [...hosts, DC_HOST], events: [structuredClone(existingTue), structuredClone(handAddedSun)],
  disciplines: lookups.disciplines,
  formats: lookups.formats.map((slug) => ({ slug, label_he: lookups.fmtLabel[slug] || slug })),
});

test("dry run: reports what would happen and writes nothing", async () => {
  const sb = fakeSupabase(seed());
  const r = await runFeed(adapter, { sb, dryRun: true, today: TODAY });
  const by = Object.fromEntries(r.items.map((i) => [i.key.split(":")[2], i]));
  assert.equal(by[10].action, "unchanged");
  assert.deepEqual(by[10].diffs.map((d) => d.field).sort(), ["time_end", "time_start", "valid_until"]);
  assert.equal(by[11].action, "insert");
  assert.equal(by[12].action, "skip");
  assert.match(by[12].reason, /אולי כבר קיים/);
  assert.match(by[13].reason, /לא ברור איפה/);
  assert.equal(by[14].reason, "כבר עבר");
  assert.equal(sb.calls.filter(([m]) => m !== "GET").length, 0, "dry run must not write");
  const text = summary(r);
  assert.match(text, /ריצת ניסיון/);
  assert.match(text, /time_start באתר "21:30", במקור "19:00"/);
});

test("live run: inserts only the new cycle, linked to the Deep Contact host; never touches the owner's times", async () => {
  const sb = fakeSupabase(seed());
  const r = await runFeed(adapter, { sb, dryRun: false, today: TODAY });
  assert.deepEqual(r.counts, { unchanged: 1, insert: 1, skip: 3 });
  const added = sb.db.events.filter((e) => e.link === "https://deepcontact.org/yesodot/yesodot_tlv_tue_jan/");
  assert.equal(added.length, 1);
  assert.equal(added[0].venue_id, "v-masl");
  assert.deepEqual(added[0].rule_weekdays, [2]);
  assert.equal(added[0].status, "live");
  assert.ok(sb.db.event_hosts.some((h) => h.event_id === added[0].id && h.host_id === "h-dc"));
  const tue = sb.db.events.find((e) => e.id === "e-tue");
  assert.equal(tue.time_start, "21:30:00", "a feed never overwrites the site's value");
  assert.equal(tue.last_verified, TODAY);
  assert.equal(sb.db.events.length, 3);
});

test("a second live run adds nothing new", async () => {
  const sb = fakeSupabase(seed());
  await runFeed(adapter, { sb, dryRun: false, today: TODAY });
  const r2 = await runFeed(adapter, { sb, dryRun: false, today: TODAY });
  assert.equal(r2.counts.insert || 0, 0);
  assert.equal(sb.db.events.length, 3);
});

test("an event the owner rejected is never added again", async () => {
  const world = seed();
  world.events.push({ ...structuredClone(existingTue), id: "e-rej", status: "rejected", link: "https://deepcontact.org/yesodot/yesodot_tlv_tue_jan/", date_start: "2027-01-05" });
  const sb = fakeSupabase(world);
  const r = await runFeed(adapter, { sb, dryRun: false, today: TODAY });
  const jan = r.items.find((i) => i.key.endsWith(":11"));
  assert.equal(jan.action, "skip");
  assert.match(jan.reason, /rejected/);
  assert.equal(r.counts.insert || 0, 0);
  assert.equal(sb.db.events.length, 3);
});
