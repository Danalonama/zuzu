// extraction → mapping → matching → questions/plan, on the Tena and ecstatic fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItem, questions, answer, finalPlan, blockers } from "../proposal.js";
import { renderCard, keyboard } from "../card.js";
import { validateRow } from "../map.js";
import { buildSchema, fromWire } from "../extract.js";
import { lookups, world, TODAY } from "./fixtures/world.js";
import { tenaExtraction, ecstaticExtraction } from "./fixtures/extractions.js";

const build = (ex) => { const w = world(); return { w, items: ex.events.map((e, i) => buildItem(e, i, w, lookups, TODAY)) }; };

test("Tena: venue matched on every event, contact normalized, link fixed", () => {
  const { items } = build(tenaExtraction);
  for (const it of items) {
    assert.equal(it.venue.chosen, "v-tena", it.row.title);
    assert.equal(it.row.phone, "052-5551234");       // mobile preferred over the landline
    assert.equal(it.row.link, "https://www.tena-studio.co.il/autumn");
    assert.deepEqual(validateRow(it.row), [], it.row.title);
  }
});

test("Tena: one-off intro → update of the existing intro, not a new event", () => {
  const { items } = build(tenaExtraction);
  const intro = items[0];
  assert.equal(intro.row.date_start, "2026-10-16");
  assert.equal(intro.row.time_start, "10:00");
  assert.equal(intro.row.rule_weekdays, null);
  assert.equal(intro.dup.candidates[0].id, "e-pf-intro");
  assert.equal(intro.dup.candidates[0].reason, "same_venue_title_other_dates");
  assert.equal(questions(intro)[0].key, "dup");          // asks "same event?" — never auto-merges
  answer(intro, "d0", world().events);
  const plan = finalPlan(intro);
  assert.equal(plan.action, "update");
  assert.equal(plan.event_id, "e-pf-intro");
  assert.equal(plan.patch.date_start, "2026-10-16");
  assert.equal(plan.patch.price_raw, "120 ₪");
  assert.ok(!("title" in plan.patch));                  // title never changed by an update
  assert.deepEqual(plan.errors, []);
});

test("Tena: 8-meeting course is a weekly rule ending on the 8th meeting, skip date kept", () => {
  const { items } = build(tenaExtraction);
  const c = items[1];
  assert.deepEqual(c.row.rule_weekdays, [1]);
  assert.equal(c.row.rule_interval_weeks, 1);
  assert.equal(c.row.date_start, "2026-10-19");
  assert.equal(c.row.valid_until, "2026-12-14");
  assert.equal(c.row.date_end, null);
  assert.deepEqual(c.exceptions, [{ on_date: "2026-11-02", kind: "skip" }]);
  assert.equal(c.row.price_min, 800);
  assert.equal(c.row.price_max, 850);
});

test("Tena: weekend is a range; the opening class is its child with an ambiguous host", () => {
  const { items } = build(tenaExtraction);
  const wk = items[2], cls = items[3];
  assert.equal(wk.row.date_start, "2026-11-13");
  assert.equal(wk.row.date_end, "2026-11-14");
  assert.deepEqual(wk.hosts.map((h) => h.chosen), ["h-maya", "h-dani-s"]);
  assert.equal(cls.parent_index, 2);
  assert.equal(cls.hosts[0].status, "ambiguous");          // "דני" = דני שחר or דני אשכנזי?
  assert.equal(questions(cls)[0].key, "host0");
  answer(cls, "h0.0", []);
  assert.ok(["h-dani-s", "h-dani-a"].includes(cls.hosts[0].chosen));
});

test("Tena: weekly jam that already exists → same event question", () => {
  const { items } = build(tenaExtraction);
  const jam = items[4];
  assert.equal(jam.dup.candidates[0].id, "e-jam");
  assert.equal(jam.row.date_start, "2026-10-01");          // next Thursday from today
  assert.equal(jam.row.valid_until, null);                  // ongoing
});

test("Tena: gaga on three weekdays is one record", () => {
  const { items } = build(tenaExtraction);
  assert.deepEqual(items[5].row.rule_weekdays, [0, 2, 4]);
  assert.equal(items[5].row.time_start, "08:30");
  assert.equal(items[5].row.date_start, "2026-10-01");     // first Sun/Tue/Thu on/after 30.9 is Thu 1.10
  assert.deepEqual(questions(items[5]), []);
  assert.deepEqual(blockers(items[5]), []);
});

test("Tena: 14 meetings from 2.11 on Mondays → valid_until 1.2.2027, new host proposed", () => {
  const { items } = build(tenaExtraction);
  const c = items[6];
  assert.equal(c.row.date_start, "2026-11-02");
  assert.equal(c.row.valid_until, "2027-02-01");
  assert.equal(c.hosts[0].chosen, "new");
  assert.equal(finalPlan(c).action, "insert");
});

test("ecstatic listing: English, venue via alias-less name + city, link kept, no phone", () => {
  const { items } = build(ecstaticExtraction);
  const e = items[0];
  assert.equal(e.row.language, "en");
  assert.equal(e.venue.chosen, "v-loft");
  assert.equal(e.row.phone, null);
  assert.equal(e.row.link, "https://ecstaticdance.org/event/tel-aviv-full-moon-2026-10-24");
  assert.deepEqual(e.row.disciplines, ["ecstatic"]);
  // same date as "ערב אקסטטי" at another venue — different title, so not a duplicate
  assert.equal(e.dup.candidates.length, 0);
  assert.deepEqual(blockers(e), []);
});

test("unknown venue is never created silently: asks, and 'new' needs a known city", () => {
  const ex = structuredClone(ecstaticExtraction.events[0]);
  ex.venue_name = "סטודיו זרימה"; ex.city = "קריית טבעון";
  const it = buildItem(ex, 0, world(), lookups, TODAY);
  assert.equal(it.venue.chosen, undefined);
  const q = questions(it)[0];
  assert.equal(q.key, "venue");
  assert.ok(q.options.some((o) => o.code === "vn"));
  answer(it, "vn", []);
  assert.ok(blockers(it).some((b) => b.includes("עיר לא מוכרת")));
});

test("live-event constraints block approve: no discipline, no contact", () => {
  const ex = structuredClone(ecstaticExtraction.events[0]);
  ex.disciplines = []; ex.link = null; ex.phones = [];
  const it = buildItem(ex, 0, world(), lookups, TODAY);
  const b = blockers(it);
  assert.ok(b.includes("חסר סוג תנועה"));
  assert.ok(b.includes("חסר קישור או טלפון"));
});

test("cards render and callback_data fits Telegram's 64-byte limit", () => {
  const { items } = build(tenaExtraction);
  for (const it of items) {
    const html = renderCard(it, lookups, items.length, 123456);
    assert.ok(html.length < 4096);
    assert.ok(html.includes("סטודיו תנע"));
    for (const row of keyboard(it, 123456).inline_keyboard) for (const b of row) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
  }
});

test("schema uses only supported JSON-schema features", () => {
  const s = JSON.stringify(buildSchema(lookups));
  for (const bad of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) assert.ok(!s.includes(`"${bad}"`), bad);
  const walk = (o) => {
    if (o && typeof o === "object") {
      if (o.type === "object") { assert.equal(o.additionalProperties, false); assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort()); }
      Object.values(o).forEach(walk);
    }
  };
  walk(buildSchema(lookups));
  // API limit: ≤ 16 union-typed parameters per schema. We use none.
  assert.ok(!s.includes('"anyOf"'), "anyOf in schema");
  assert.ok(!/"type":\[/.test(s), "type array in schema");
});

test("fromWire turns \"\" / -1 / 0 back into null, and keeps real values", () => {
  const wire = {
    message_notes: "",
    events: [{
      title: "x", language: "he", description: "", disciplines: ["gaga"], formats: [], audience: [],
      venue_name: "תנע", city: "", location_on_registration: false, hosts: [{ name: "נועם", kind: "" }],
      schedule: { kind: "weekly", date_start: "2026-11-02", date_end: "", weekdays: [1], interval_weeks: 1, sessions_count: 0, valid_until: "", time_start: "18:00", time_end: "", skip_dates: [] },
      price: { raw: "", kind: "", min: -1, max: 0, unit: "" },
      link: "", phones: [], parent_index: -1, notes: "", source_quote: "",
    }],
  };
  const d = fromWire(wire);
  const e = d.events[0];
  assert.equal(d.message_notes, null);
  assert.equal(e.description, null);
  assert.equal(e.city, null);
  assert.equal(e.venue_name, "תנע");
  assert.equal(e.hosts[0].kind, null);
  assert.equal(e.schedule.date_end, null);
  assert.equal(e.schedule.sessions_count, null);
  assert.equal(e.schedule.interval_weeks, 1);
  assert.equal(e.schedule.time_start, "18:00");
  assert.equal(e.price.min, null);
  assert.equal(e.price.max, 0); // free
  assert.equal(e.parent_index, null);
  assert.equal(e.link, null);
  const item = buildItem(e, 0, world(), lookups, TODAY);
  assert.equal(item.row.valid_until, null);
  assert.equal(item.venue.chosen, "v-tena");
});
