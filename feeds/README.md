# Feeds (v2)

Sources that publish structured data are read once a day by Vercel Cron (decided 9.10, board f01).
Each source has an adapter in `feeds/` and a function in `api/feeds/`; the schedule is in `vercel.json` → `crons`.

A run feeds every item through the bot's own pipeline (`bot/`: mapping, venue/host matching, duplicate
check, writing), with stricter rules than the bot, because nobody approves a card:

- **Publish** only when everything is clear: the venue and the host are known, and nothing on the site
  looks like the same event. Anything else is **skipped and reported**, never guessed.
- **An event the source already published** (same link) is never changed, except to fill an empty field.
  Your edits win. Differences in date or time are reported only.
- Nothing is ever deleted.
- Every run is recorded in `feed_runs`, and a summary goes to the bot owner(s) on Telegram.

## Sources

| Source | Adapter | Schedule (UTC) | What it reads |
|---|---|---|---|
| Deep Contact | `feeds/deepcontact.js` | 03:10 daily | WordPress REST `yesodot` (courses) and `mavoyesodot` (intro workshops); date, place, weekday and time from the title |

## Setup (once)

1. Supabase SQL editor: run `v2/db/2026-10-14-feed-runs.sql`.
2. Vercel → Settings → Environment Variables (Production): `CRON_SECRET` = a random string
   (`openssl rand -hex 24`). Without it the function refuses every call. The bot's variables
   (`SUPABASE_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_IDS`) are reused.
3. Redeploy. Runs are **dry** (write nothing, only report) until step 4.
4. After you've checked a dry-run report: add `FEEDS_LIVE` = `deepcontact` (comma-separated for more
   sources) and redeploy. Remove it to go back to dry runs.

Run one now: Vercel → the project → Settings → Cron Jobs → **Run** next to the job.

## Tests

`npm test` (offline, fake Supabase).
