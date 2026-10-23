// Editing page backend: checks and writes against the bot's fake Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeSupabase } from "../../bot/test/fakes.js";
import { lookups as L, venues, cities, hosts, events } from "../../bot/test/fixtures/world.js";
import { load, lookups, saveEvent, addException, removeException, saveVenue, createHost } from "../actions.js";
import { passwordOk } from "../../api/admin.js";

const T0 = "2026-10-01T10:00:00.000000+00:00";
function world() {
  const sb = fakeSupabase({
    venues, cities, hosts,
    events: events.map((e) => ({ ...e, updated_at: T0 })),
    event_hosts: [{ event_id: "e-jam", host_id: "h-noam" }],
    event_exceptions: [{ event_id: "e-jam", on_date: "2026-10-08", kind: "skip", note: null }],
    disciplines: L.disciplines, formats: L.formats.map((slug) => ({ slug, label_he: slug })), regions: [],
  });
  return sb;
}

test("load joins hosts and exceptions to their event, and lists allowed values", async () => {
  const d = await load(world());
  const jam = d.events.find((e) => e.id === "e-jam");
  assert.deepEqual(jam.host_ids, ["h-noam"]);
  assert.equal(jam.exceptions[0].on_date, "2026-10-08");
  assert.ok(d.enums.status.includes("live"));
  assert.deepEqual(d.enums.price_kind, L.priceKinds); // from the enum, not guessed
  assert.ok(d.enums.exception_kind.includes("skip"));
});

test("a save is normalized like the bot does it, and only listed fields go through", async () => {
  const sb = world();
  const e = await saveEvent(sb, await lookups(sb), { id: "e-other", updated_at: T0, patch: { time_start: "20:00", phone: "0525551234", link: "example.org/y" } });
  assert.equal(e.time_start, "20:00");
  assert.equal(e.phone, "052-5551234");
  assert.equal(e.link, "https://example.org/y");
  assert.notEqual(e.updated_at, T0);
  await assert.rejects(saveEvent(sb, await lookups(sb), { id: "e-other", patch: { canonical_key: "x" } }), /שדה לא מוכר/);
});

test("a live event without a style or without link and phone is refused before Supabase", async () => {
  const sb = world();
  await assert.rejects(saveEvent(sb, await lookups(sb), { id: "e-other", updated_at: T0, patch: { disciplines: [] } }), /חסר סוג תנועה/);
  await assert.rejects(saveEvent(sb, await lookups(sb), { id: "e-other", updated_at: T0, patch: { link: "" } }), /חסר קישור או טלפון/);
  assert.equal(sb.calls.filter(([m]) => m === "PATCH").length, 0);
  // Hidden (not live) may be incomplete.
  const lk = await lookups(sb);
  lk.enums.status.push("hidden");
  const e = await saveEvent(sb, lk, { id: "e-other", updated_at: T0, patch: { status: "hidden", link: "" } });
  assert.equal(e.status, "hidden");
});

test("someone else changed the event since it was opened → 409 with the current version, nothing written", async () => {
  const sb = world();
  sb.db.events.find((e) => e.id === "e-other").updated_at = "2026-10-02T00:00:00+00:00";
  await assert.rejects(
    saveEvent(sb, await lookups(sb), { id: "e-other", updated_at: T0, patch: { title: "חדש" } }),
    (err) => err.status === 409 && err.current.title === "ערב אקסטטי",
  );
  assert.equal(sb.db.events.find((e) => e.id === "e-other").title, "ערב אקסטטי");
});

test("hosts of an event are replaced by the list sent", async () => {
  const sb = world();
  const e = await saveEvent(sb, await lookups(sb), { id: "e-jam", updated_at: T0, host_ids: ["h-maya", "h-dani-s"] });
  assert.deepEqual(e.host_ids.sort(), ["h-dani-s", "h-maya"]);
  await assert.rejects(saveEvent(sb, await lookups(sb), { id: "e-jam", host_ids: ["nope"] }), /מנחה לא קיים/);
});

test("skipped dates: add, refuse a second change on the same day, remove", async () => {
  const sb = world();
  const lk = await lookups(sb);
  let e = await addException(sb, lk, { event_id: "e-jam", on_date: "2026-10-15", kind: "skip" });
  assert.deepEqual(e.exceptions.map((x) => x.on_date).sort(), ["2026-10-08", "2026-10-15"]);
  await assert.rejects(addException(sb, lk, { event_id: "e-jam", on_date: "2026-10-15", kind: "skip" }), /כבר יש שינוי/);
  e = await removeException(sb, { event_id: "e-jam", on_date: "2026-10-08" });
  assert.deepEqual(e.exceptions.map((x) => x.on_date), ["2026-10-15"]);
});

test("renaming a venue keeps the old name as an alias; a name another venue has is refused", async () => {
  const sb = world();
  const v = await saveVenue(sb, await lookups(sb), { id: "v-tena", patch: { name: "תנע — בית לתנועה" } });
  assert.equal(v.name, "תנע — בית לתנועה");
  assert.deepEqual(v.aliases.sort(), ["סטודיו תנע", "תנע"].sort());
  await assert.rejects(saveVenue(sb, await lookups(sb), { id: "v-loft", patch: { aliases: "בואנה" } }), /כבר שייכים ל"בוא'נה"/);
});

test("a new host whose name another host already has (by alias) is refused", async () => {
  const sb = world();
  await assert.rejects(createHost(sb, await lookups(sb), { name: "Maya Golan" }), /מאיה גולן/);
  const h = await createHost(sb, await lookups(sb), { name: "רוני לוי", kind: "person" });
  assert.equal(h.name, "רוני לוי");
});

test("password: compared whole, never open without one", () => {
  assert.equal(passwordOk("abc", ""), false);
  assert.equal(passwordOk("", "secret-secret"), false);
  assert.equal(passwordOk("secret-secreT", "secret-secret"), false);
  assert.equal(passwordOk("secret-secret", "secret-secret"), true);
});

test("a hosts-only save bumps the version, so a second editor's stale save gets the 409", async () => {
  const sb = world();
  const e = await saveEvent(sb, await lookups(sb), { id: "e-jam", updated_at: T0, host_ids: ["h-maya"] });
  assert.notEqual(e.updated_at, T0);
  await assert.rejects(
    saveEvent(sb, await lookups(sb), { id: "e-jam", updated_at: T0, host_ids: ["h-noam", "h-dani-a"] }),
    (err) => err.status === 409 && err.current.host_ids.join() === "h-maya",
  );
  // Nothing changed → nothing written, version kept.
  const same = await saveEvent(sb, await lookups(sb), { id: "e-jam", updated_at: e.updated_at, host_ids: ["h-maya"] });
  assert.equal(same.updated_at, e.updated_at);
});
