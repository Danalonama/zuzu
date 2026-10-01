// intake_drafts: one row per forwarded message. Keeps the raw text and Claude's output untouched (decision E4)
// and the proposals with their review state. See v2/db/2026-09-30-intake-bot.sql.

export async function createDraft(sb, { update_id, chat_id, message_id, raw_text, images = null }) {
  try {
    const [row] = await sb.insert("intake_drafts", [{ telegram_update_id: update_id, chat_id, source_message_id: message_id, raw_text, images }]);
    return row;
  } catch (e) {
    if (e.code === "23505") return null; // Telegram re-delivered this update: already handled
    throw e;
  }
}

export async function loadDraft(sb, id) {
  const [row] = await sb.get(`intake_drafts?select=*&id=eq.${Number(id)}`);
  return row || null;
}

const FIELDS = ["items", "status", "extraction", "model", "usage", "error", "summary_message_id"];

/**
 * Save with optimistic locking on `version`. If another button press saved first, reload and
 * re-apply only the items this call touched (`touched` = indexes), then save again.
 */
export async function saveDraft(sb, draft, touched = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const patch = Object.fromEntries(FIELDS.filter((f) => f in draft).map((f) => [f, draft[f]]));
    patch.version = draft.version + 1;
    patch.updated_at = new Date().toISOString();
    const rows = await sb.update(`intake_drafts?id=eq.${draft.id}&version=eq.${draft.version}`, patch);
    if (rows.length) { Object.assign(draft, rows[0]); return draft; }
    const fresh = await loadDraft(sb, draft.id);
    const idx = touched ?? draft.items.map((_, i) => i);
    for (const i of idx) fresh.items[i] = draft.items[i];
    for (const f of FIELDS) if (f !== "items" && draft[f] !== undefined && f !== "status") fresh[f] = draft[f];
    draft = Object.assign(draft, fresh, { items: fresh.items });
  }
  throw new Error("draft save conflict — try again");
}
