# zuzu v2

Status: not started. Data-model decisions live in `../docs/zuzu-v2-data-model-questions.md`.

Planned layout (filled in as each step lands):
- `db/` — Supabase schema (SQL migrations) + the canonical-key function (one implementation, used everywhere).
- `api/` — Vercel serverless functions: read endpoint for the site, Telegram webhook, feed cron.
- `bot/` — Telegram reviewer logic (extraction prompt, card rendering, approve/reject handlers).
- `import/` — one-shot import of the v1 sheet export through the new dedup.

Secrets (Supabase keys, Telegram token, Anthropic key) go in Vercel environment variables. Never in this repo.
