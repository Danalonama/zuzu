# Zuzu — working to-do (updated 2026-10-01, hidden pages added)

Site = `index.html` on GitHub → Vercel (zuzu.today). Backend = `zuzu-events.gs` (Google Apps Script) on the `zuzu-events` Google Sheet. Reviewer = `review.html` → host in the same repo as index.html so it lives at **zuzu.today/review.html** (permanent, reads the queue live).

## Automation status ✅ ALL LIVE
`listZuzuTriggers()` = **7 triggers**; `ANTHROPIC_API_KEY` set.
- **syncEcstatic** — Sundays ~07:00 (auto-approve, tagged מסיבה).
- **syncTribeEvents** — daily ~05:00 → **publishes LIVE** (auto-approve).
- **syncFeeds** — every 6h iCal → **publishes LIVE by default** (opt out per-feed with FALSE in the feeds sheet).
- **syncInbox** — every 5 min (posters) → stays in REVIEW.
- **dedupeApprovedByHostDateTime** — daily ~04:00 (now time-normalized).
- syncNewsletters + syncBodyways. Helpers: `installAllZuzuTriggers()`, `listZuzuTriggers()`.

## KEY LESSON (2026-09-05): don't hand-add feed-covered events
The feeds (bodyways / newsletters) already carry most studio events. Hand-adding them created duplicates (Iris, Michal Halfen both duped a feed). **Rule: only hand-add feed-LESS sources** (Suzanne Dellal Gaga = Arbox, Gohar = personal Wix site). For everything a feed covers, let the feed do it.

## Dupe hardening (2026-09-05)
Root causes of the dupe flood: (1) hand-adds duplicating feeds; (2) malformed times ("1800" vs "18:00") so the host+date+time dedupe key missed matches (also a display bug).
- `_normTime24()` — every ingested time → clean HH:MM (in `_submitEvent` + used in the dedupe key).
- `normalizeTimes()` — one-shot: fixes every existing time cell.
- **`cleanupZuzu()`** — one-click: normalizeTimes → removeIrisNiceEvents → removeMakatzveiHalev → applySuppressions → dedupeApprovedByHostDateTime. Run whenever the queue gets messy.
- `removeIrisNiceEvents()` / `removeMakatzveiHalev()` — undo the hand-added feed dupes.

## Events on hiatus (suppression)
`SUPPRESSED` list at top of Code.gs hides matching events from the LIVE site until a date (matched on title+host), even if a feed re-adds them; auto-returns after the date. `applySuppressions()` unpublishes current live matches.
- Active: **מעבר לגוף** (ג'אם קונטקט, עמית שמואלי/עילי עוזר) — until **2026-09-30** ⚠ placeholder date, confirm with them.

## Reviewer v3.6 (hosted)
Collapsed list + checkboxes + **bulk-approve** (selected / all); one-at-a-time "focus mode" optional. Multi-value **type** field (chips) — type now splits on commas everywhere.

## Multi-value type + audience tags (2026-09-05)
Event type/format now splits on commas across site + reviewer + backend. Audience tags unified to **"נשים בלבד" / "גברים בלבד"** (fixed old "לגברים בלבד" mismatch); work from type OR discipline field, render as a highlighted orange pill, and are their own filter. TYPES list includes both.

## Recurring venues (repeat=weekly, LIVE) — feed-less, safe to keep
- ✅ **Suzanne Dellal Gaga** — `setupSuzanneDellalGaga()`, 15 weekly slots + monthly teacher rotation (paste screenshot → re-run; `_deleteBySource` first). Arbox live-sync investigated, NOT viable (token-gated JWT; recurring grid + monthly paste instead).
- ✅ **Gohar** — `setupGoharClass()` (Pardes Hana, weekly from 14.10; מחול+ריקודי בטן · שיעור+נשים בלבד; replaces on re-run).
- ✅ **לנוע** + **TEO** Gaga slots. Gaga naming fixes: `retitleGagaClasses()`, `fixLanuaName()`, `fixLanuaGaga()`.
- ⚠ **Maoz HaYam / Yaniv Tzadick / Michal / Iris** — CHECK if a feed already carries these; if so they're the hand-add dupes to remove. Suzanne Dellal + Gohar are the confirmed keepers.

## Adding a batch of events (e.g. the Contact-org newsletter)
Paste the whole newsletter into the reviewer's add box → AI splits into events → bulk-approve. Keep dated events; reject date-less year-long programs. Best: subscribe the zuzu-inbox address to the org's newsletter → `syncNewsletters` auto-ingests every issue.

## NEXT — further reduce manual work
1. **Add more Tribe/iCal sources** — highest payoff; every studio on WordPress/Events-Calendar or with an iCal feed = fully hands-off. Collect feed URLs.
2. **Smarter dedupe for host-token mismatches** — e.g. "DJ Liran" vs "Liran", spelling variants — currently keys on host first-token; consider fuzzier matching.
3. **Fill the 18 no-link classes**; **trim 99 stale past-dated seed rows**.
4. Manual-add form: make its type field multi (card editor already is).

## Hidden pages — finish, then link (added 2026-10-01)
Both are public at their URL but nothing on the site links to them. Kept hidden on purpose until they're ready.
- **`styles-guide.html`** — "אילו סוגי תנועה יש בכלל?" beginner guide (per style: description, YouTube example, link to its events). First version of the "which movement is right for me?" idea. To do: the 10 style illustrations are missing (`assets/improv, ecstatic, research, biodanza, mahol, gaga, movement, nia, contact, freedance .png`) — upload them or drop the image slots; check the style list matches the site's current disciplines; then link it from `index.html`.
- **`about.html`** — "עליי ותודות" (story + source credits). To do: finish/review the copy and the credits list (check it matches today's sources); then link it from `index.html` (top bar or footer).

## Sources — status
- ✅ Tribe adapter (auto-publishing). ⏳ Choreographers (re-check 404). ❌ Being (image), Silo/Naim (Wix), Arbox/Gaga (token-gated). Backlog: Biodanza, Contact board, zygo/vibez, ci-events.

## Reference
- Data audit: `claude/data-audit-2026-08-10.md` · Sources: `claude/zuzu-sources-competitors.md` · Tagging: `claude/tagging-learning-2026-08-23.md`
