// Telegram card (HTML parse mode) + inline keyboard for one proposal.
import { questions, blockers, finalPlan } from "./proposal.js";
import { heDate, heDay } from "./normalize.js";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const AUDIENCE_HE = {
  women_only: "נשים בלבד", men_only: "גברים בלבד", beginners_welcome: "מתאים למתחילים",
  parents_with_kids: "הורים וילדים", sixty_plus: "60+", partner_needed: "צריך בן/בת זוג",
};
const FIELD_HE = {
  date_start: "התחלה", date_end: "סיום", rule_weekdays: "ימים", rule_interval_weeks: "כל X שבועות",
  valid_until: "עד", time_start: "שעה", time_end: "עד שעה", price_raw: "מחיר", price_kind: "סוג מחיר",
  price_min: "מחיר מינ׳", price_max: "מחיר מקס׳", price_unit: "יחידת מחיר", link: "קישור", phone: "טלפון",
  description: "תיאור", disciplines: "סוגי תנועה", formats: "פורמט", audience: "קהל",
};

export function scheduleLine(r) {
  const time = r.time_start ? ` · ${r.time_start}${r.time_end ? "–" + r.time_end : ""}` : "";
  if (r.rule_weekdays?.length) {
    const days = r.rule_weekdays.map(heDay).join(", ");
    const every = r.rule_interval_weeks > 1 ? `כל ${r.rule_interval_weeks} שבועות ` : "כל ";
    const until = r.valid_until ? ` עד ${heDate(r.valid_until, true)}` : " · מתמשך";
    return `🔁 ${every}יום ${days}${time}\n    מ-${heDate(r.date_start, true)}${until}`;
  }
  if (r.date_end) return `🗓 ${heDate(r.date_start)}–${heDate(r.date_end, true)}${time}`;
  return r.date_start ? `🗓 יום ${heDay(new Date(r.date_start + "T12:00:00Z").getUTCDay())} ${heDate(r.date_start, true)}${time}` : "🗓 ❗ אין תאריך";
}

const fmtVal = (v) => (v == null ? "—" : Array.isArray(v) ? v.join(",") : String(v).slice(0, 60));

/**
 * @param item   proposal
 * @param lk     { discLabel:{slug:label}, fmtLabel:{slug:label} }
 * @param total  number of items in the draft
 */
export function renderCard(item, lk, total, draftId) {
  const r = item.row;
  const L = [];
  const plan = finalPlan(item);
  const head = item.state === "approved" ? "✅ נשמר" : item.state === "rejected" ? "❌ נדחה" : plan.action === "update" ? "🔄 עדכון לאירוע קיים" : "🆕 חדש";
  L.push(`<b>${item.idx + 1}/${total}</b> · ${head}`);
  L.push(`<b>${esc(r.title)}</b>`);
  L.push(scheduleLine(r));
  if (item.exceptions.length) L.push(`    ⏸ בלי: ${item.exceptions.map((x) => heDate(x.on_date)).join(", ")}`);

  const v = item.venue;
  if (v.chosen === "onreg") L.push("📍 המיקום יימסר בהרשמה");
  else if (v.chosen === "new") L.push(`📍 ➕ מקום חדש: ${esc(v.name)}${v.city_name ? " · " + esc(v.city_name) : ""}${v.city_id ? "" : " ❗עיר לא מוכרת"}`);
  else if (v.chosen) {
    const c = v.candidates.find((x) => x.id === v.chosen);
    const asWritten = c && v.name && c.name !== v.name ? ` <i>(בטקסט: ${esc(v.name)})</i>` : "";
    L.push(`📍 ${esc(c?.name || v.chosen)}${c?.city ? " · " + esc(c.city) : ""} ✓${asWritten}`);
  } else L.push(`📍 ❓ ${esc(v.name || "לא צוין")}${v.city_name ? " · " + esc(v.city_name) : ""}`);

  if (item.hosts.length) {
    L.push("👤 " + item.hosts.map((h) => {
      if (h.chosen === "new") return `${esc(h.name)} (חדש)`;
      if (h.chosen) { const c = h.candidates.find((x) => x.id === h.chosen); return `${esc(c?.name || h.name)} ✓`; }
      return `${esc(h.name)} ❓`;
    }).join(" · "));
  }
  const tags = [
    ...r.disciplines.map((s) => lk.discLabel?.[s] || s),
    ...r.formats.map((s) => lk.fmtLabel?.[s] || s),
    ...r.audience.map((s) => AUDIENCE_HE[s] || s),
  ];
  if (tags.length) L.push("🏷 " + esc(tags.join(" · ")));
  if (r.price_raw) L.push("💰 " + esc(r.price_raw));
  const contact = [r.phone && `📞 ${esc(r.phone)}`, r.link && `🔗 ${esc(r.link)}`].filter(Boolean).join("  ");
  if (contact) L.push(contact);
  if (item.parent_index != null) L.push(`↳ חלק מאירוע ${item.parent_index + 1}`);

  if (plan.action === "update") {
    const t = item.dup.candidates.find((c) => c.id === plan.event_id);
    L.push(`\n🔄 <b>עדכון של:</b> ${esc(t?.title)} (${heDate(t?.date_start, true)})`);
    if (!plan.changes.length) L.push("    אין שינויים — רק יסמן כמאומת");
    for (const c of plan.changes) L.push(`    • ${FIELD_HE[c.field] || c.field}: ${esc(fmtVal(c.from))} ← ${esc(fmtVal(c.to))}`);
  } else if (item.dup.candidates.length && item.dup.chosen === undefined) {
    L.push("\n👯 <b>אולי כבר קיים:</b>");
    item.dup.candidates.forEach((c, i) => L.push(`    ${i + 1}. ${esc(c.title)} · ${heDate(c.date_start, true)}${c.rule_weekdays?.length ? " (שבועי)" : ""}`));
  }

  if (item.state === "pending") {
    if (item.warnings.length) L.push("\n⚠️ " + esc(item.warnings.join(" · ")));
    if (item.ext.notes) L.push("📝 " + esc(item.ext.notes));
    const b = blockers(item).filter((x) => x !== "יש שאלות פתוחות");
    if (b.length) L.push("⛔ " + esc(b.join(" · ")));
    const qs = questions(item);
    if (qs.length) L.push("\n❓ " + qs.map((q) => esc(q.text)).join("\n❓ "));
  } else if (item.result?.event_id) {
    L.push(`\n<code>${esc(item.result.event_id)}</code>`);
  }
  L.push(`\n<i>#${draftId}/${item.idx + 1}</i>`);
  return L.join("\n");
}

/** callback_data ≤ 64 bytes: "<op>:<draftId>:<idx>[:<code>]" */
export function keyboard(item, draftId) {
  if (item.state !== "pending") return { inline_keyboard: [] };
  const cb = (op, code) => `${op}:${draftId}:${item.idx}${code ? ":" + code : ""}`;
  const rows = [];
  for (const q of questions(item).slice(0, 1)) { // one question at a time keeps the card readable
    for (const o of q.options) rows.push([{ text: o.label.slice(0, 60), callback_data: cb("q", o.code) }]);
  }
  rows.push([
    { text: "✅ אשר", callback_data: cb("ok") },
    { text: "✏️ תקן", callback_data: cb("fix") },
    { text: "❌ דחה", callback_data: cb("no") },
  ]);
  return { inline_keyboard: rows };
}

export function summaryText(draft) {
  const n = draft.items.length;
  const by = (s) => draft.items.filter((i) => i.state === s).length;
  const notes = draft.extraction?.message_notes ? `\n📝 ${esc(draft.extraction.message_notes)}` : "";
  if (!n) return `לא מצאתי אירועים בהודעה.${notes}`;
  return `📥 <b>${n} אירועים</b> · ✅ ${by("approved")} · ❌ ${by("rejected")} · ⏳ ${by("pending")}${notes}\n<i>#${draft.id}</i>`;
}

export function summaryKeyboard(draft) {
  if (!draft.items.some((i) => i.state === "pending")) return { inline_keyboard: [] };
  return {
    inline_keyboard: [[
      { text: "✅ אשר את כל המוכנים", callback_data: `all:${draft.id}:0` },
      { text: "❌ דחה את השאר", callback_data: `none:${draft.id}:0` },
    ]],
  };
}
