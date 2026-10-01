# zuzu.today

Curated calendar of movement & dance events in Israel.

**Status (2026-10-01):** the live site still runs on v1 (Google Sheet + Apps Script). v2 (Supabase + Telegram bot) is in progress in open PRs (#1 site → Supabase, #2 intake bot). Tasks live on the task board artifact, not in this repo. See `CLAUDE.md` for links and the current state.

## Layout
- `index.html` — the live site (already in this repo; Vercel serves the root).
- `review.html` — the reviewer, v3.7. Served at https://zuzu.today/review.html.
- `apps-script/zuzu-events.gs` — the v1 backend (Google Apps Script on the `zuzu-events` Sheet).
  Kept here for version control only (kept off the public site by `.vercelignore` once PR #6 merges;
  until then Vercel most likely serves it like any other file — unverified). The deployed copy lives in the
  Apps Script editor — any change must be pasted there and redeployed as a new version.
- `docs/` — product notes, audits, the tagging-learning logs, and the original v2 data-model questions
  (historical: many were since decided in Supabase; the older to-do files there are superseded by the task board).
- `v2/` — the rebuild (Supabase + Telegram reviewer + Vercel functions). See `v2/README.md`.
- `CLAUDE.md` — orientation for Claude sessions: where the real state lives (board, rebuild plan, PRs, Supabase).

## v1 rules (until v2 cuts over)
- Do not hand-add events a feed already carries.
- Do not add new fix-functions to the `.gs`. Live embarrassments only.
