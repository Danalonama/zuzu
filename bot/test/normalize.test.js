import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, nameScore, normalizePhone, normalizeLink, normalizeTime, nthMeeting, weekday } from "../normalize.js";
import { matchVenue, matchHost } from "../match.js";
import { venues, cities, hosts } from "./fixtures/world.js";

test("norm strips geresh, nikud, punctuation and final letters", () => {
  assert.equal(norm("בוא'נה"), norm("בואנה"));
  assert.equal(norm("שָׁלוֹם!"), norm("שלום"));
  assert.equal(norm("PLAY-FIGHT"), "play fight");
});

test("venue spelling variants match (the merged duplicates)", () => {
  assert.ok(nameScore("סטודיו תנע", "תנע", { stop: true }) >= 0.92);
  assert.ok(nameScore("בואנה", "בוא'נה", { stop: true }) >= 0.92);
  assert.ok(nameScore("האחים מסלאויטה 7", "האחים מסלאוויטה 7", { stop: true }) >= 0.92);
  assert.ok(nameScore("האחים מסלויטה 7", "האחים מסלאוויטה 7", { stop: true }) >= 0.92);
  assert.ok(nameScore("סטודיו תנע", "סטודיו זרימה", { stop: true }) < 0.55);
});

test("matchVenue: matched, via alias, cross-script alias, unknown", () => {
  assert.equal(matchVenue({ venue_name: "תנע", city: "עין שמר" }, venues, cities).candidates[0].venue.id, "v-tena");
  assert.equal(matchVenue({ venue_name: "סטודיו תנע", city: null }, venues, cities).status, "matched");
  assert.equal(matchVenue({ venue_name: "TEO", city: "הרצליה" }, venues, cities).candidates[0].venue.id, "v-teo");
  assert.equal(matchVenue({ venue_name: "בוא׳נה", city: "פרדס חנה" }, venues, cities).status, "matched");
  const unk = matchVenue({ venue_name: "סטודיו זרימה", city: "חיפה" }, venues, cities);
  assert.equal(unk.status, "unknown");
});

test("matchHost: exact, alias, ambiguous first name, new", () => {
  assert.equal(matchHost("נועם ברק", hosts).status, "matched");
  assert.equal(matchHost("Maya Golan", hosts).candidates[0].host.id, "h-maya");
  const dani = matchHost("דני", hosts);
  assert.equal(dani.status, "ambiguous"); // two Danis: must ask, never pick silently
  assert.equal(matchHost("רותם לוי", hosts).status, "new");
});

test("phones normalize to the DB format", () => {
  assert.equal(normalizePhone("052-555-1234"), "052-5551234");
  assert.equal(normalizePhone("+972 52 555 1234"), "052-5551234");
  assert.equal(normalizePhone("0525551234"), "052-5551234");
  assert.equal(normalizePhone("04-6371234"), "04-6371234");
  assert.equal(normalizePhone("077 1234567"), "077-1234567");
  assert.equal(normalizePhone("1-800-123"), null);
});

test("links and times", () => {
  assert.equal(normalizeLink("www.tena-studio.co.il/autumn"), "https://www.tena-studio.co.il/autumn");
  assert.equal(normalizeLink("https://x.org/a)."), "https://x.org/a");
  assert.equal(normalizeLink("#"), null);
  assert.equal(normalizeTime("8:30"), "08:30");
  assert.equal(normalizeTime("1800"), "18:00");
  assert.equal(normalizeTime("20:00:00"), "20:00");
  assert.equal(normalizeTime("25:00"), null);
});

test("nth meeting skips holidays", () => {
  // 8 Mondays from 19.10, no meeting on 2.11 → 19.10, 26.10, 9.11, …, 7.12
  assert.equal(nthMeeting("2026-10-19", [1], 1, 8, ["2026-11-02"]), "2026-12-14");
  assert.equal(nthMeeting("2026-10-19", [1], 1, 8), "2026-12-07");
  assert.equal(weekday("2026-11-02"), 1);
});
