// Thin Telegram Bot API wrapper.

export function createTelegram({ token = process.env.TELEGRAM_BOT_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
  async function call(method, params) {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await r.json();
    // "message is not modified" is harmless (same card re-rendered).
    if (!data.ok && !/not modified/.test(data.description || "")) throw new Error(`telegram ${method}: ${data.description}`);
    return data.result;
  }
  return {
    call,
    send: (chat_id, text, extra = {}) =>
      call("sendMessage", { chat_id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra }),
    edit: (chat_id, message_id, text, extra = {}) =>
      call("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra }),
    answer: (callback_query_id, text) => call("answerCallbackQuery", { callback_query_id, text }),
    typing: (chat_id) => call("sendChatAction", { chat_id, action: "typing" }),
  };
}
