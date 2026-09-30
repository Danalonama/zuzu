// Telegram update → intake / review actions. All I/O comes in through `deps` so tests can fake it.
import { extractEvents } from "./extract.js";
import { loadLookups, loadWorld, loadEvents } from "./db.js";
import { buildItem, answer, blockers } from "./proposal.js";
import { renderCard, keyboard, summaryText, summaryKeyboard, esc } from "./card.js";
import { approveItem, ApproveError } from "./write.js";
import { createDraft, loadDraft, saveDraft } from "./drafts.js";
import { todayIL } from "./normalize.js";

const HELP = `שלום! העבירו לכאן הודעה (וואטסאפ, ניוזלטר, פוסט) עם אירועים.
אחזיר כרטיס לכל אירוע: ✅ אשר · ✏️ תקן · ❌ דחה.
✏️ תקן — עונים להודעה שאשלח במילים חופשיות ("השעה 19:30, כל יום שני").
שום דבר לא נשמר באתר בלי ✅.`;

const FIX_RE = /תיקון #(\d+)\/(\d+)/;

export function ownerIds(env = process.env) {
  return new Set(String(env.TELEGRAM_OWNER_IDS || "").split(/[,\s]+/).filter(Boolean).map(Number));
}

/** Text to extract from: the message text/caption, with the forward origin as a hint (often the studio). */
export function messageText(msg) {
  const text = msg.text || msg.caption || "";
  const o = msg.forward_origin;
  const from = o?.chat?.title || o?.sender_user?.first_name && [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(" ") || o?.sender_user_name || msg.forward_sender_name;
  return from ? `[הועבר מ: ${from}]\n${text}` : text;
}

export async function handleUpdate(update, deps) {
  const owners = deps.owners || ownerIds();
  if (update.message) {
    const m = update.message;
    if (!owners.has(m.from?.id)) return; // everyone else is ignored, silently
    return handleMessage(update, m, deps);
  }
  if (update.callback_query) {
    const q = update.callback_query;
    if (!owners.has(q.from?.id)) return;
    return handleCallback(q, deps);
  }
}

async function handleMessage(update, m, deps) {
  const { tg } = deps;
  const chat = m.chat.id;
  const text = messageText(m).trim();
  if (!text || /^\/(start|help)\b/.test(text)) return tg.send(chat, HELP);
  if (text === "/id") return tg.send(chat, `user id: <code>${m.from.id}</code>`);
  const fix = m.reply_to_message && (m.reply_to_message.text || "").match(FIX_RE);
  if (fix) return handleFix(chat, Number(fix[1]), Number(fix[2]) - 1, text, deps);
  return handleIntake(update, m, text, deps);
}

async function handleIntake(update, m, text, deps) {
  const { sb, tg } = deps;
  const today = deps.today || todayIL();
  const chat = m.chat.id;
  const draft = await createDraft(sb, { update_id: update.update_id, chat_id: chat, message_id: m.message_id, raw_text: text });
  if (!draft) return; // duplicate delivery
  const status = await tg.send(chat, "⏳ קוראת את ההודעה…", { reply_parameters: { message_id: m.message_id } });
  try {
    const [lk, world] = await Promise.all([loadLookups(sb), loadWorld(sb, today)]);
    const ex = await (deps.extract || extractEvents)({ text, lookups: lk, today });
    draft.extraction = ex.data;
    draft.model = ex.model;
    draft.usage = ex.usage;
    draft.items = (ex.data.events || []).map((e, i) => buildItem(e, i, world, lk, today));
    draft.summary_message_id = status.message_id;
    draft.status = draft.items.length ? "open" : "done";
    await saveDraft(sb, draft);
    await tg.edit(chat, status.message_id, summaryText(draft), { reply_markup: summaryKeyboard(draft) });
    for (const item of draft.items) {
      const sent = await tg.send(chat, renderCard(item, lk, draft.items.length, draft.id), { reply_markup: keyboard(item, draft.id) });
      item.card_message_id = sent.message_id;
    }
    await saveDraft(sb, draft);
  } catch (e) {
    draft.status = "failed";
    draft.error = String(e.message || e);
    await saveDraft(sb, draft).catch(() => {});
    await tg.edit(chat, status.message_id, `⚠️ לא הצלחתי לעבד: ${esc(draft.error)}\n<i>#${draft.id}</i>`).catch(() => {});
  }
}

async function refreshCard(deps, draft, item, lk) {
  if (!item.card_message_id) return;
  await deps.tg.edit(draft.chat_id, item.card_message_id, renderCard(item, lk, draft.items.length, draft.id), { reply_markup: keyboard(item, draft.id) });
}
async function refreshSummary(deps, draft) {
  if (!draft.summary_message_id) return;
  if (draft.items.every((i) => i.state !== "pending")) draft.status = "done";
  await deps.tg.edit(draft.chat_id, draft.summary_message_id, summaryText(draft), { reply_markup: summaryKeyboard(draft) });
}

async function handleCallback(q, deps) {
  const { sb, tg } = deps;
  const today = deps.today || todayIL();
  const [op, draftId, idxS, code] = String(q.data || "").split(":");
  const draft = await loadDraft(sb, draftId);
  if (!draft) return tg.answer(q.id, "הטיוטה לא נמצאה");
  const lk = await loadLookups(sb);
  const idx = Number(idxS);
  const item = draft.items[idx];

  if (op === "all" || op === "none") return bulk(op, q, draft, lk, today, deps);
  if (!item) return tg.answer(q.id, "לא נמצא");
  if (item.state !== "pending") return tg.answer(q.id, "כבר טופל");

  if (op === "q") {
    const events = code.startsWith("v") ? await loadEvents(sb, today) : [];
    if (!answer(item, code, events)) return tg.answer(q.id, "?");
    await saveDraft(sb, draft, [idx]);
    await refreshCard(deps, draft, item, lk);
    return tg.answer(q.id, "✓");
  }
  if (op === "no") {
    item.state = "rejected";
    await saveDraft(sb, draft, [idx]);
    await refreshCard(deps, draft, item, lk);
    await refreshSummary(deps, draft);
    await saveDraft(sb, draft);
    return tg.answer(q.id, "נדחה");
  }
  if (op === "fix") {
    await tg.send(draft.chat_id, `✏️ תיקון #${draft.id}/${idx + 1} — מה לתקן ב"${esc(item.row.title)}"? (השיבו להודעה הזו)`, {
      reply_markup: { force_reply: true, input_field_placeholder: "למשל: השעה 19:30, המקום הוא סטודיו תנע" },
    });
    return tg.answer(q.id, "");
  }
  if (op === "ok") {
    try {
      const res = await approveItem(sb, draft, item, lk, today);
      await saveDraft(sb, draft, [idx]);
      await refreshCard(deps, draft, item, lk);
      await refreshSummary(deps, draft);
      await saveDraft(sb, draft);
      return tg.answer(q.id, res.action === "update" ? "עודכן ✅" : "נשמר ✅");
    } catch (e) {
      // Chosen venue/host ids may have been created before the failure; keep them on the draft.
      await saveDraft(sb, draft, [idx]).catch(() => {});
      await refreshCard(deps, draft, item, lk).catch(() => {});
      const msg = e instanceof ApproveError ? e.message : `שגיאה: ${e.message}`;
      return tg.call("answerCallbackQuery", { callback_query_id: q.id, text: msg.slice(0, 190), show_alert: true });
    }
  }
  return tg.answer(q.id, "?");
}

async function bulk(op, q, draft, lk, today, deps) {
  const { sb, tg } = deps;
  const pending = draft.items.filter((i) => i.state === "pending");
  let done = 0, skipped = 0;
  if (op === "none") {
    for (const it of pending) { it.state = "rejected"; done++; }
  } else {
    // parents before children
    const order = [...pending].sort((a, b) => (a.parent_index == null ? 0 : 1) - (b.parent_index == null ? 0 : 1));
    for (const it of order) {
      if (blockers(it).length) { skipped++; continue; }
      try { await approveItem(sb, draft, it, lk, today); done++; } catch { skipped++; }
    }
  }
  await saveDraft(sb, draft);
  for (const it of pending) await refreshCard(deps, draft, it, lk).catch(() => {});
  await refreshSummary(deps, draft);
  await saveDraft(sb, draft);
  return tg.answer(q.id, op === "none" ? `נדחו ${done}` : `אושרו ${done}${skipped ? `, ${skipped} צריכים תשובה/תיקון` : ""}`);
}

async function handleFix(chat, draftId, idx, instruction, deps) {
  const { sb, tg } = deps;
  const today = deps.today || todayIL();
  const draft = await loadDraft(sb, draftId);
  const item = draft?.items[idx];
  if (!item) return tg.send(chat, "לא מצאתי את האירוע לתיקון");
  if (item.state !== "pending") return tg.send(chat, "האירוע כבר טופל");
  await tg.typing(chat).catch(() => {});
  try {
    const [lk, world] = await Promise.all([loadLookups(sb), loadWorld(sb, today)]);
    const ex = await (deps.extract || extractEvents)({ text: draft.raw_text, lookups: lk, today, revision: { current: item.ext, instruction } });
    const revised = ex.data.events?.[0];
    if (!revised) return tg.send(chat, "לא הבנתי את התיקון — נסו שוב במילים אחרות");
    const next = buildItem(revised, idx, world, lk, today);
    next.card_message_id = item.card_message_id;
    next.fixes = [...(item.fixes || []), instruction];
    draft.items[idx] = next;
    await saveDraft(sb, draft, [idx]);
    await refreshCard(deps, draft, next, lk);
    await tg.send(chat, `✏️ עודכן כרטיס ${idx + 1} ⬆️`);
  } catch (e) {
    await tg.send(chat, `⚠️ התיקון נכשל: ${esc(e.message)}`);
  }
}
