# zuzu v2

Status: Telegram intake bot built (`../bot/`, `../api/telegram.js`, `db/2026-09-30-intake-bot.sql`) — see `../bot/README.md`. Data-model decisions live in `../docs/zuzu-v2-data-model-questions.md`.

Planned layout (filled in as each step lands):
- `db/` — Supabase schema (SQL migrations) + the canonical-key function (one implementation, used everywhere).
- `api/` — Vercel serverless functions: read endpoint for the site, Telegram webhook, feed cron.
- `bot/` — Telegram reviewer logic (extraction prompt, card rendering, approve/reject handlers).
- `import/` — one-shot import of the v1 sheet export through the new dedup.

Secrets (Supabase keys, Telegram token, Anthropic key) go in Vercel environment variables. Never in this repo.

## Current status (2026-10-01)
The status line above is out of date: v2 is in progress.
- Supabase is live, and the Apps Script backend mirrors new events into its queue (`event_submissions`).
- The site's switch to Supabase is in PR #1 (branch `v2`). The Telegram intake bot is in PR #2.
- The data-model questions doc is historical. The Supabase schema is the source of truth.
- Tasks: see the task board linked in `../CLAUDE.md`.
