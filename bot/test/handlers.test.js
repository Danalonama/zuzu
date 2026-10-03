// End-to-end through the webhook handler with fake Supabase/Telegram and a canned extraction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpdate } from "../handlers.js";
import { fakeSupabase, fakeTelegram } from "./fakes.js";
import { lookups, venues, cities, hosts, events, TODAY } from "./fixtures/world.js";
import { tenaExtraction } from "./fixtures/extractions.js";

const OWNER = 111, CHAT = 111;
const seed = () => ({
  venues, cities, hosts, events,
  disciplines: lookups.disciplines,
  formats: lookups.formats.map((slug) => ({ slug, label_he: lookups.fmtLabel[slug] || slug })),
});

function setup() {
  const sb = fakeSupabase(seed()), tg = fakeTelegram();
  const extractCalls = [];
  const deps = {
    sb, tg, today: TODAY, owners: new Set([OWNER]),
    extract: async (args) => { extractCalls.push(args); return { data: structuredClone(tenaExtraction), model: "test", usage: {} }; },
  };
  let uid = 1;
  const msg = (text, extra = {}) => handleUpdate({ update_id: uid++, message: { message_id: uid * 10, from: { id: OWNER }, chat: { id: CHAT }, text, ...extra } }, deps);
  const press = (data) => handleUpdate({ update_id: uid++, callback_query: { id: "cb" + uid, from: { id: OWNER }, data } }, deps);
  return { sb, tg, deps, msg, press, extractCalls };
}
const card = (tg, n) => tg.sent.filter((m) => m.extra.reply_markup?.inline_keyboard?.some((r) => r.some((b) => b.callback_data?.startsWith("ok:"))))[n];

test("strangers are ignored", async () => {
  const { sb, tg, deps } = setup();
  await handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 999 }, chat: { id: 999 }, text: "hi" } }, deps);
  assert.equal(tg.sent.length, 0);
  assert.equal(sb.db.intake_drafts.length, 0);
});

test("forward → summary + one card per event; re-delivered update is processed once", async () => {
  const { sb, tg, deps, extractCalls } = setup();
  const upd = { update_id: 77, message: { message_id: 5, from: { id: OWNER }, chat: { id: CHAT }, text: "…tena…", forward_origin: { type: "channel", chat: { title: "סטודיו תנע" } } } };
  await handleUpdate(upd, deps);
  await handleUpdate(upd, deps);
  assert.equal(extractCalls.length, 1);
  assert.match(extractCalls[0].text, /הועבר מ: סטודיו תנע/);
  assert.equal(sb.db.intake_drafts.length, 1);
  assert.equal(sb.db.intake_drafts[0].items.length, 7);
  assert.equal(tg.sent.length, 8); // status/summary + 7 cards
  assert.match(tg.edits[0].text, /7 אירועים/);
});

test("approve a clean card inserts event + hosts; gaga has no questions", async () => {
  const { sb, tg, msg, press } = setup();
  await msg("tena");
  const before = sb.db.events.length;
  await press("ok:1:5"); // גאגא בוקר
  assert.equal(sb.db.events.length, before + 1);
  const ev = sb.db.events.at(-1);
  assert.deepEqual(ev.rule_weekdays, [0, 2, 4]);
  assert.equal(ev.venue_id, "v-tena");
  assert.equal(ev.status, "live");
  assert.equal(sb.db.intake_drafts[0].items[5].state, "approved");
  assert.match(tg.answers.at(-1).text, /נשמר/);
});

test("card with open question can't be approved; answering 'update' patches the existing event", async () => {
  const { sb, tg, msg, press } = setup();
  await msg("tena");
  await press("ok:1:0");
  assert.equal(tg.answers.at(-1).alert, true);                 // blocked: "same event?" open
  await press("q:1:0:d0");                                      // → update e-pf-intro
  await press("ok:1:0");
  const intro = sb.db.events.find((e) => e.id === "e-pf-intro");
  assert.equal(intro.date_start, "2026-10-16");
  assert.equal(intro.price_raw, "120 ₪");
  assert.equal(intro.title, "PLAY-FIGHT סדנת מבוא");            // title untouched
  assert.equal(sb.db.events.length, events.length);             // no insert
});

test("course insert writes the skip exception; new host created once", async () => {
  const { sb, msg, press } = setup();
  await msg("tena");
  await press("q:1:1:dn");   // PLAY-FIGHT course is a new event
  await press("ok:1:1");
  const course = sb.db.events.find((e) => e.title === "PLAY-FIGHT – קורס");
  assert.equal(course.valid_until, "2026-12-14");
  assert.deepEqual(sb.db.event_exceptions.filter((x) => x.event_id === course.id).map((x) => x.on_date), ["2026-11-02"]);
  await press("ok:1:6");     // 14-meeting course, host "רותם לוי" is new
  assert.equal(sb.db.hosts.filter((h) => h.name === "רותם לוי").length, 1);
});

test("child needs its parent approved first; approve-all orders parents first", async () => {
  const { sb, tg, msg, press } = setup();
  await msg("tena");
  await press("q:1:3:h0.0");  // דני → דני שחר
  await press("ok:1:3");
  assert.match(tg.answers.at(-1).text, /קודם לאשר את אירוע 3/);
  await press("all:1:0");
  const d = sb.db.intake_drafts[0];
  assert.equal(d.items[2].state, "approved");
  assert.equal(d.items[3].state, "approved");
  const child = sb.db.events.find((e) => e.id === d.items[3].result.event_id);
  assert.equal(child.parent_id, d.items[2].result.event_id);
  // items with open "same event?" questions were skipped, not guessed
  assert.equal(d.items[0].state, "pending");
  assert.equal(d.items[4].state, "pending");
});

test("reject, and ✏️ fix re-extracts one event from the reply", async () => {
  const { sb, tg, deps, msg, press, extractCalls } = setup();
  await msg("tena");
  await press("no:1:5");
  assert.equal(sb.db.intake_drafts[0].items[5].state, "rejected");
  await press("fix:1:6");
  const prompt = tg.sent.at(-1);
  assert.match(prompt.text, /תיקון #1\/7/);
  deps.extract = async (args) => {
    extractCalls.push(args);
    const e = structuredClone(args.revision.current);
    e.schedule.time_start = "19:00";
    return { data: { events: [e], message_notes: null }, model: "test", usage: {} };
  };
  await msg("השעה 19:00", { reply_to_message: { message_id: prompt.message_id, text: prompt.text } });
  assert.equal(extractCalls.at(-1).revision.instruction, "השעה 19:00");
  assert.equal(sb.db.intake_drafts[0].items[6].row.time_start, "19:00");
});

test("screenshot: largest photo size is downloaded and sent to Claude; kept for ✏️ fixes", async () => {
  const { sb, tg, msg, extractCalls } = setup();
  await msg(undefined, { photo: [{ file_id: "small", file_size: 1000 }, { file_id: "big", file_size: 90000 }], caption: "מה יש בתנע" });
  assert.deepEqual(tg.files, ["big"]);
  assert.equal(extractCalls[0].images.length, 1);
  assert.equal(extractCalls[0].images[0].media_type, "image/jpeg");
  assert.equal(extractCalls[0].text, "מה יש בתנע");
  assert.match(tg.sent[0].text, /קוראת את התמונה/);
  assert.deepEqual(sb.db.intake_drafts[0].images, [{ file_id: "big", media_type: "image/jpeg", size: 90000 }]);
  assert.equal(sb.db.intake_drafts[0].items.length, 7);
});

test("photo with no caption works; non-image files and >5MB images are refused", async () => {
  const { sb, tg, msg, extractCalls } = setup();
  await msg(undefined, { photo: [{ file_id: "p1" }] });
  assert.equal(extractCalls.length, 1);
  await msg(undefined, { document: { file_id: "d1", mime_type: "application/pdf" } });
  assert.match(tg.sent.at(-1).text, /רק טקסט ותמונות/);
  await msg(undefined, { document: { file_id: "d2", mime_type: "image/png", file_size: 9e6 } });
  assert.equal(extractCalls.length, 1);
  assert.equal(sb.db.intake_drafts.at(-1).status, "failed");
  assert.match(tg.edits.at(-1).text, /5MB/);
});
