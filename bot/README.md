# zuzu intake bot (Telegram → Claude → review card → Supabase)

Forward any text with events (a studio's WhatsApp message, a newsletter, a Facebook post) to the bot.
It extracts the events with Claude, matches them against Supabase, and sends back one review card
per event. **Nothing is written to Supabase until you press ✅.**

```
api/telegram.js      webhook (Vercel function): checks the secret, answers 200, works in the background
bot/handlers.js      message → draft → cards; buttons; ✏️ fix replies
bot/extract.js       Claude call (structured output — the JSON shape is fixed)
bot/map.js           extraction → events row (dates, N meetings → valid_until, phones, links, DB checks)
bot/match.js         venue / host / existing-event matching (fuzzy on Hebrew spelling)
bot/proposal.js      one proposal per event + its open questions
bot/card.js          Hebrew card + buttons
bot/write.js         approve → insert/update events, event_hosts, event_exceptions, hosts, venues
bot/drafts.js        intake_drafts table (raw text + Claude output kept forever)
v2/db/2026-09-30-intake-bot.sql   run once in Supabase
```

## The card

```
2/7 · 🆕 חדש
PLAY-FIGHT – קורס
🔁 כל יום ב׳ · 20:00–21:30
    מ-19.10.2026 עד 14.12.2026
    ⏸ בלי: 2.11
📍 סטודיו תנע · עין שמר ✓
👤 נועם ברק ✓
🏷 פליי פייט · קורס
💰 850 ₪ / 800 ₪ בהרשמה מוקדמת עד 10.10
📞 052-5551234  🔗 https://www.tena-studio.co.il/autumn
👯 אולי כבר קיים: 1. PLAY-FIGHT סדנת מבוא · 18.9.2026
❓ אותו אירוע?
[🔄 לעדכן: PLAY-FIGHT סדנת מבוא]  [➕ אירוע חדש]
[✅ אשר] [✏️ תקן] [❌ דחה]
```

- **Questions come first, one at a time**, as buttons. ✅ is refused (popup) while a question is open
  or a DB check would fail (no discipline, no link/phone, …).
  - **Venue** not clearly matched → up to 3 candidates, "➕ new venue: X", or "location on registration".
    A new venue is only created from that button, and only if its city is already in `cities`.
  - **Host** that looks like an existing one ("דני" when there are two Danis) → pick one or "➕ new host".
    A host with no similar name is shown as "(חדש)" and created on ✅.
  - **Same event?** when an existing event has the same venue + similar title (any dates), the same
    venue + same weekday/time, or a very similar title on overlapping dates. "🔄 update" shows the
    field-by-field diff; never merged without you pressing it.
- **✏️ תקן** → the bot asks "what to fix?"; reply to that message in plain Hebrew
  ("השעה 19:30, כל יום שני", "המקום הוא בוא'נה"). Claude re-reads that one event, and the card is redrawn.
  Answers already given on that card are cleared and asked again.
- **Summary message**: "✅ approve all ready" approves every card with no open question/problem
  (parents before their child classes). "❌ reject the rest" rejects the pending ones.

What an **update** changes (proposal for decision E3; confirm or change in `buildUpdate` in `bot/map.js`):
dates/times/weekdays/valid_until move together to the new text; price/link/phone/description are
overwritten only when the new text has them; disciplines/formats/audience are merged; title, venue and
hosts are never changed. New hosts and skip dates are added.

## Setup

### 1. Supabase
Run `v2/db/2026-09-30-intake-bot.sql` in the SQL editor. It adds `venues.aliases`, the
`intake_drafts` table (service_role only), and `intake_column_enum()` (lets the bot read the real
enum labels for price_kind / price_unit / host kind / venue kind instead of hard-coding them).

Then put the merged-away venue spellings into `venues.aliases`, e.g.
`update venues set aliases = '{תנע}' where name = 'סטודיו תנע';` — cross-script names
("TEO הרצליה" ↔ "מרכז תאו") can only match through an alias.

### 2. Telegram bot
1. In Telegram, open **@BotFather** → `/newbot` → name + username → copy the **token**.
2. Optional: `/setprivacy` → Enable (the bot is used in a private chat anyway).

### 3. Vercel environment variables
Project `zuzu.today` → Settings → Environment Variables (Production, and Preview if you test on a preview URL):

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | any random string, e.g. `openssl rand -hex 24` |
| `TELEGRAM_OWNER_IDS` | your numeric Telegram user id (comma-separated for more than one) — send any message to **@userinfobot** to get it. Everyone else is ignored. |
| `SUPABASE_URL` | `https://eiseowpkwexktqrtoeaq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` (secret — never in the repo or the browser) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `CLAUDE_MODEL` | optional, default `claude-opus-5-5` |
| `CLAUDE_EFFORT` | optional, default `medium` (`low` is cheaper/faster, `high` more careful) |
| `NEW_VENUE_KIND` | optional; kind for venues created from "➕ new venue" (default `studio` if that value exists) |

Redeploy after adding them.

### 4. Point Telegram at the webhook
```bash
TOKEN=...            # bot token
SECRET=...           # same as TELEGRAM_WEBHOOK_SECRET
URL=https://zuzu.today/api/telegram     # or the preview deployment URL
curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=$URL" -d "secret_token=$SECRET" \
  -d 'allowed_updates=["message","callback_query"]' -d "drop_pending_updates=true"
curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"   # check last_error_message
```
If a preview deployment has Vercel Deployment Protection on, Telegram gets a 401 from Vercel before
the function runs — use the production URL or a protection-bypass.

### 5. First test
Open the bot, `/start`, then forward the Studio Tena message. Expected: a summary + one card per
event, venue "סטודיו תנע" matched, courses as weekly rules ending on the Nth meeting.

## Tests
```bash
npm install
npm test                                   # offline: mapping, matching, cards, handler flow with fakes
ZUZU_LIVE=1 ANTHROPIC_API_KEY=... npm test # + real extraction of the two fixtures (a few cents)
```
`bot/test/fixtures/tena-message.txt` is a **stand-in written in the style of** the Tena message, not the
real one — replace it with the real text when you have it, and adjust `extractions.js` / the live test.

## Cost & limits
- One Claude call per forwarded message, one per ✏️ fix. Real token counts are stored per message in
  `intake_drafts.usage`. Rough estimate (not measured): a ~10-event message ≈ 5k input + 3–8k output
  tokens on `claude-opus-5-5` ($4 / $20 per M) ≈ $0.10–0.20; a fix ≈ $0.05.
- Telegram splits messages over 4096 characters; a long newsletter arrives as 2+ messages and is
  handled as 2+ separate drafts.
- Only text/captions are read — not images or PDFs.
- The function is set to `maxDuration: 300` s. If your Vercel plan's limit is lower, the deploy will
  say so; lower it in `api/telegram.js`.
- Writes are several REST calls, not one transaction. If a step after the event insert fails, the bot
  deletes what it inserted; a venue/host created just before a failure stays (it's a real one).
