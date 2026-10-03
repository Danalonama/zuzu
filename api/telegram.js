// Telegram webhook (Vercel Node function). Setup: bot/README.md.
// Answers 200 at once and keeps working in the background (waitUntil), so Telegram doesn't
// time out and re-send the update while Claude is still extracting.
import { waitUntil } from "@vercel/functions";
import { handleUpdate } from "../bot/handlers.js";
import { createSupabase } from "../bot/supabase.js";
import { createTelegram } from "../bot/telegram.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("zuzu intake bot");
  // Set by setWebhook(secret_token=…): proves the request comes from Telegram.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(401).end();

  const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const deps = { sb: createSupabase(), tg: createTelegram() };
  waitUntil(
    handleUpdate(update, deps).catch((e) => console.error("zuzu bot: update", update?.update_id, e)),
  );
  return res.status(200).json({ ok: true });
}
