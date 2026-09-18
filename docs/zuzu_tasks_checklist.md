# zuzu.today — Task Checklist

*Living doc — reorder and add freely. Updated: 30.8.2026*

**Current status:** The site is live and working. The store is the "זוזו אירועים" Google Sheet (served to Vercel via Apps Script). Automation is now broad — 7 triggers firing; Tribe + iCal feeds auto-publish; ecstatic auto-syncs Sundays; recurring studios (Maoz HaYam, Suzanne Dellal Gaga, לנוע/TEO Gaga, Yaniv Tzadick) are permanent weekly slots. See `claude/zuzu-todo.md` for the live technical to-do (this file is the older product checklist).

**Priority key:** P0 = now (do first) · P1 = next · P2 = later · P3 = polish/backlog
**Estimates** are rough dev-effort sizes; several depend on the Apps-Script-vs-Python decision for the newsletter pipeline.

---

## Event sources (growing the store)

| Task | Prio | Why this priority (product consideration) | Est. |
|---|---|---|---|
| Newsletters — wire the `upsert` to the Sheet (`approved=FALSE`) | P0 | Biggest lever: module already built; multiplies auto-sources beyond bodyways; brings the live layer scrapers miss | ~0.5–1 day |
| Newsletters — add its own trigger (or manual run) | P0 | Comes with the above; useless un-triggered | ~30 min |
| Newsletters — wire `llm_extract` (model call) | P1 | Needed for text newsletters; the extraction quality gate | ~0.5 day |
| Newsletters — wire `ocr_images` (Hebrew OCR) | P2 | Only for image-only newsletters; hardest part, lowest hit-rate | ~1–2 days |
| coing — find the events-list endpoint (Network tab) | P1 | Unlocks the whole platform; small recon, big payoff | ~1–2 hrs |
| coing — build the iCal adapter | P1 | One adapter = all coing communities; structured/clean data | ~0.5–1 day |
| Telegram — pick approach + start | P2 | Net-new source, real value, but not blocking; needs a choice first | ~1–2 days (MVP) |
| "Requires browser" — Studio Naim (~1000 classes) | P2 | Biggest single missing source, but needs headless-browser infra | ~1–2 days |
| Platform strategy — one adapter per platform | P2 | Efficiency multiplier; larger architectural work, do after coing proves it | ~1 day/adapter |
| Tag the un-statused rows in the sources sheet | P2 | Housekeeping; keeps the inventory usable | ~30 min |

## Data quality & model

| Task | Prio | Why this priority (product consideration) | Est. |
|---|---|---|---|
| Dedup key (date + city + discipline) | P0 | Do *before* adding sources — else every new source multiplies duplicates; infra for everything | ~0.5 day |
| Relevance filter at scale | P1 | Prevents noise as volume grows; partly in the newsletter module already | ~0.5 day |
| Freshness/confidence + `last_verified` | P1 | Prevents showing dead events — the worst failure for a discovery site | ~1 day |
| "Details coming soon" handling | P1 | Visible quality gap; confirm the exact site condition first, then fill/fix | ~1 hr + source fix |
| `type` field (class/jam/workshop/retreat…) | P2 | Model clarity; unblocks the "which movement" feature, but not urgent | ~2–4 hrs |
| `location_disclosure` field | P2 | Needed for nature events/retreats; recurring but narrow | ~2–4 hrs |
| Fix `syncBodyways` timeout (~30% fail) | P2 | Partial success today, so not urgent; still worth hardening | ~2–4 hrs |

## Content & growth

| Task | Prio | Why this priority (product consideration) | Est. |
|---|---|---|---|
| Publish the social post (Hebrew/English/both) | P1 | Quick, high-visibility growth; drafts ready | ~30 min |
| Post in the designers' group + ask for feedback | P1 | Free design critique from peers; low effort | ~15 min |

## UX & design

| Task | Prio | Why this priority (product consideration) | Est. |
|---|---|---|---|
| "Which movement is right for me?" guided entry | P2 | Genuine differentiator; leans on the existing `discipline` taxonomy — but biggest of the four | ~2–3 days |
| English version of the site | P2 | Needs a *scope* decision first (who for?), not just translation | decision + ~1–2 days |
| Dark mode | P3 | Polish; nice-to-have, no user-blocking need | ~0.5 day |
| Cooler / stronger visual design | P3 | Polish; subjective and open-ended | ~ongoing |

## Infrastructure

| Task | Prio | Why this priority (product consideration) | Est. |
|---|---|---|---|
| Update Claude Desktop so the Cowork tab returns | P0 | Blocks moving the pipeline work into Cowork | ~10 min |
| Confirm the DNS record shows green in Vercel | P0 | Fast verify; loose end from the DNS fix | ~5 min |
| Move pipeline work into Cowork (+ re-attach files) | P1 | Right surface for the multi-file Apps Script wiring | ~15 min setup |

## Waiting on your decision / action

| Task | Prio | Why this priority (product consideration) | Est. |
|---|---|---|---|
| Share the repo link | P2 | Deprioritized — store is the Sheet, not the repo | ~2 min |

---

### One product insight worth remembering
There's a tension between **volume** and **quality**: adding sources (newsletters, coing) grows the event count — but without dedup, a relevance filter, and freshness, more volume = more noise, duplicates, and dead events. That's why the P0 set pairs "wire newsletters" *with* "dedup key" rather than doing all the sources first. zuzu's value is the *curation*, not the quantity.

---

## Done
- [x] Fixed the DNS redirect loop — A record is correct (confirm it shows green in Vercel)
- [x] Diagnosed "the feed isn't updating" — the site is fine and bodyways runs; the 27.7 assumption was wrong
- [x] Built the newsletter ingestion module `newsletter_ingest.py` — tested on 8 real emails
- [x] Confirmed coing exposes structured iCal on every event page
- [x] Drafted social posts (Hebrew / English / designers' group)
- [x] Manually processed 2 events (Dor Frank · coing, "The Body in Nature" · Iris Nice)
- [x] **Iris Nice — trial + display resolved (30.8):** it's a course; first session (8.9) is the open/trial. Both offerings added live via `setupIrisNiceEvents()` — בוקר אור (single, 11.9) + סדרת הסתיו (8-session course). Contact = Iris's phone 053-447-6385. ⚠ City tentative (שפיים/שרון) — confirm with Iris. (Closes the two "Waiting on you" items #12 + #13.)
- [x] **Add the 2 manually-processed events** — both now on the site.
