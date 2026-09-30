// Request shape (offline, fake client) + an optional live run against the real API.
// Live: ANTHROPIC_API_KEY=… ZUZU_LIVE=1 npm test   (costs a few cents per run)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractEvents } from "../extract.js";
import { buildItem } from "../proposal.js";
import { lookups, world, TODAY } from "./fixtures/world.js";

const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

function fakeClient(reply, stop_reason = "end_turn") {
  const seen = [];
  return {
    seen,
    beta: { messages: { stream: (params) => { seen.push(params); return { finalMessage: async () => ({ model: params.model, stop_reason, usage: {}, content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(reply) }] }) }; } } },
  };
}

test("request: structured output schema, fallback, today in the prompt", async () => {
  const client = fakeClient({ events: [], message_notes: "אין אירועים" });
  const r = await extractEvents({ text: "שלום", lookups, today: TODAY, client, model: "claude-opus-5-5" });
  const p = client.seen[0];
  assert.equal(p.model, "claude-opus-5-5");
  assert.equal(p.output_config.format.type, "json_schema");
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.ok(!("thinking" in p) || p.thinking.type === "adaptive");
  assert.match(p.system, /Today is 2026-09-30/);
  assert.equal(r.data.message_notes, "אין אירועים");
});

test("refusal and truncation surface as errors", async () => {
  await assert.rejects(extractEvents({ text: "x", lookups, today: TODAY, client: fakeClient({}, "refusal") }), /declined/);
  await assert.rejects(extractEvents({ text: "x", lookups, today: TODAY, client: fakeClient({}, "max_tokens") }), /cut off/);
});

const live = process.env.ZUZU_LIVE && process.env.ANTHROPIC_API_KEY ? test : test.skip;

live("LIVE: Tena message extracts to the expected events", { timeout: 300_000 }, async () => {
  const { data, usage } = await extractEvents({ text: fixture("tena-message.txt"), lookups, today: TODAY });
  console.log("usage", usage);
  const items = data.events.map((e, i) => buildItem(e, i, world(), lookups, TODAY));
  const by = (re) => items.find((i) => re.test(i.row.title));
  assert.ok(items.length >= 6 && items.length <= 8, `got ${items.length}`);
  for (const i of items) assert.equal(i.venue.chosen, "v-tena", i.row.title);
  const course = by(/קורס/);
  assert.deepEqual(course.row.rule_weekdays, [1]);
  assert.equal(by(/מבוא/).row.date_start, "2026-10-16");
  assert.deepEqual(by(/גאגא/).row.rule_weekdays, [0, 2, 4]);
  assert.equal(by(/מדיטציה/).row.valid_until, "2027-02-01");
});

live("LIVE: ecstaticdance-style listing", { timeout: 300_000 }, async () => {
  const { data } = await extractEvents({ text: fixture("ecstatic-listing.txt"), lookups, today: TODAY });
  assert.equal(data.events.length, 1);
  const it = buildItem(data.events[0], 0, world(), lookups, TODAY);
  assert.equal(it.row.date_start, "2026-10-24");
  assert.equal(it.row.time_start, "11:00");
  assert.equal(it.venue.chosen, "v-loft");
  assert.ok(it.row.link.startsWith("https://ecstaticdance.org/"));
});
