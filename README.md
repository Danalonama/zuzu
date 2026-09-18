# zuzu.today

Curated calendar of movement & dance events in Israel.

## Layout
- `index.html` — the live site (already in this repo; Vercel serves the root).
- `review.html` — the reviewer, v3.7. Served at https://zuzu.today/review.html.
- `apps-script/zuzu-events.gs` — the v1 backend (Google Apps Script on the `zuzu-events` Sheet).
  Kept here for version control only; Vercel ignores it. The deployed copy lives in the
  Apps Script editor — any change must be pasted there and redeployed as a new version.
- `docs/` — product notes, audits, the tagging-learning logs, and the v2 data-model decisions.
- `v2/` — the rebuild (Supabase + Telegram reviewer + Vercel functions). See `v2/README.md`.

## v1 rules (until v2 cuts over)
- Do not hand-add events a feed already carries.
- Do not add new fix-functions to the `.gs`. Live embarrassments only.
