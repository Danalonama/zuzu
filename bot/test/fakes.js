// In-memory stand-ins for Supabase (the subset of PostgREST the bot uses) and Telegram.
import { lookups } from "./fixtures/world.js";

let seq = 0;
const newId = (t) => `${t}-new-${++seq}`;

function parse(path) {
  const [table, qs = ""] = path.split("?");
  const filters = [];
  for (const part of qs.split("&").filter(Boolean)) {
    const eq = part.indexOf("=");
    const k = part.slice(0, eq), v = decodeURIComponent(part.slice(eq + 1));
    if (["select", "order", "limit"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    filters.push({ k, op, val: rest.join(".") });
  }
  return { table, filters };
}
const match = (row, filters) => filters.every(({ k, op, val }) => {
  const x = row[k];
  if (op === "eq") return String(x) === val;
  if (op === "neq") return String(x) !== val;
  if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/"/g, "")).includes(String(x));
  throw new Error("fake: unsupported op " + op);
});

export function fakeSupabase(seed) {
  const db = { intake_drafts: [], event_hosts: [], event_exceptions: [], ...structuredClone(seed) };
  const calls = [];
  const rows = (t) => (db[t] = db[t] || []);
  const withEmbeds = (t, r) => (t === "venues" ? { ...r, city: db.cities.find((c) => c.id === r.city_id) || null } : r);
  const checkEvent = (e) => {
    if (e.status === "live" && (!e.disciplines?.length || (!e.link && !e.phone))) throw Object.assign(new Error("check"), { code: "23514", body: { message: "live check" } });
    const key = `${e.date_start}|${e.title}|${e.venue_id}`;
    if (rows("events").some((x) => x.id !== e.id && `${x.date_start}|${x.title}|${x.venue_id}` === key)) throw Object.assign(new Error("dup"), { code: "23505", body: {} });
  };
  const sb = {
    db, calls,
    async get(path) { calls.push(["GET", path]); const { table, filters } = parse(path); return structuredClone(rows(table).filter((r) => match(r, filters)).map((r) => withEmbeds(table, r))); },
    async all(path) { return sb.get(path); },
    async insert(table, list) {
      calls.push(["POST", table, list]);
      const out = [];
      for (const r of list) {
        const row = { ...r };
        if (table === "intake_drafts") {
          if (rows(table).some((d) => d.telegram_update_id === r.telegram_update_id)) throw Object.assign(new Error("dup"), { code: "23505", body: {} });
          Object.assign(row, { id: rows(table).length + 1, items: [], status: "processing", version: 0 });
        } else if (!["event_hosts", "event_exceptions"].includes(table)) row.id = newId(table);
        if (table === "events") checkEvent(row);
        rows(table).push(row);
        out.push(structuredClone(row));
      }
      return out;
    },
    async update(path, patch) {
      calls.push(["PATCH", path, patch]);
      const { table, filters } = parse(path);
      const hit = rows(table).filter((r) => match(r, filters));
      for (const r of hit) { if (table === "events") checkEvent({ ...r, ...patch }); Object.assign(r, structuredClone(patch)); }
      return structuredClone(hit);
    },
    async del(path) { calls.push(["DELETE", path]); const { table, filters } = parse(path); db[table] = rows(table).filter((r) => !match(r, filters)); },
    async rpc(fn, { tbl, col }) {
      const m = { "events.price_kind": lookups.priceKinds, "events.price_unit": lookups.priceUnits, "hosts.kind": lookups.hostKinds, "venues.kind": lookups.venueKinds, "events.audience": lookups.audience };
      return m[`${tbl}.${col}`] || null;
    },
  };
  return sb;
}

export function fakeTelegram() {
  let mid = 1000;
  const sent = [], edits = [], answers = [];
  return {
    sent, edits, answers,
    async send(chat_id, text, extra = {}) { const m = { chat_id, text, extra, message_id: ++mid }; sent.push(m); return m; },
    async edit(chat_id, message_id, text, extra = {}) { edits.push({ chat_id, message_id, text, extra }); return true; },
    async answer(id, text) { answers.push({ id, text }); },
    async call(method, p) { if (method === "answerCallbackQuery") answers.push({ id: p.callback_query_id, text: p.text, alert: p.show_alert }); },
    async typing() {},
    files: [],
    async fileBase64(file_id) { this.files.push(file_id); return Buffer.from("img:" + file_id).toString("base64"); },
    /** Latest keyboard for a card message. */
    buttons(message_id) {
      const e = [...edits].reverse().find((x) => x.message_id === message_id);
      const src = e || sent.find((x) => x.message_id === message_id);
      return src.extra.reply_markup?.inline_keyboard.flat() || [];
    },
  };
}
