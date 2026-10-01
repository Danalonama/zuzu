# zuzu v2

Status: **database built and tested locally** (1.10.2026); not yet applied to Supabase.
The model and every decision behind it: [`MODEL.md`](MODEL.md).

Planned layout (filled in as each step lands):
- `db/` — ✅ Supabase schema, canonical key, duplicate detection, ingest, the site's read function. See `db/README.md`.
- `api/` — Vercel serverless functions: read endpoint for the site, Telegram webhook, feed cron.
- `bot/` — Telegram reviewer logic (extraction prompt, card rendering, approve/reject handlers).
- `import/` — one-shot import of the v1 sheet export through the new dedup.

Secrets (Supabase keys, Telegram token, Anthropic key) go in Vercel environment variables. Never in this repo.
