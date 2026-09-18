# Zuzu — events-store data audit & dedup correction
*Run 2026-08-10 against the live `zuzu-events` Google Sheet (342 rows) + `newsletter_ingest.py`.*

## Headline
The newsletter module is well built, but its **dedup key is wrong for the real data**, and the store is **75% stale**. Fixing dedup is genuinely a P0 that must land *before* newsletters/coing scale up — otherwise more sources = more noise, exactly the volume-vs-quality trap.

## What the data shows (342 rows)
- **Sources:** bodyways 304, newsletter 22, manual 6, blank 8, email 1, facebook 1.
- **Approved:** 331 TRUE / 11 FALSE.
- **Freshness:** **258 of 342 (75%) are past-dated** (before today 2026-08-10). Only **84** are today-or-future. The live site hides them by date-filter, but the store carries a lot of dead weight and no `last_verified`/freshness signal.
- **Date formats are mixed:** 312 ISO (`2026-07-27`) vs 30 US `M/D/Y` (`8/10/2026`). Any string comparison across the two silently fails.

## The dedup finding (the important one)
Candidate keys tested on the store:
| Key | Duplicate groups caught |
|---|---|
| date + **city + discipline** (current code) | **1** |
| date + normalised **title** | **42** |
| date + title + venue | 41 |

- In **all 42** real duplicate groups, the **discipline differs** across the duplicate rows. Discipline is the field that *varies* for one real event, so putting it in the key **splits true duplicates apart**.
- **39 of 42** are within a single source: **bodyways emits the same event once per discipline tag.** Live example today (2026-08-10): *"שיעורי ביודנסה עם סילבי"* appears twice — once tagged `ביודנסה`, once `מובמנט`, same venue. These are showing on the live site right now.
- **city is often empty**, so a city-based key collapses to `date||discipline` and can *merge different events* (false positives) while missing the real ones.
- Cross-source **near-duplicates** already exist and exact keys can't catch them, e.g. bodyways *"שיעור קונטקט אימפרוביזציה בכליל"* vs newsletter *"קונטקט אימפרוביזציה עם נדב וטליה"* (same date 2026-07-27). This is the pattern that explodes when newsletters/coing are added.

## Recommendation
1. **Identity = normalised `date_start` + normalised `title`** (+ `venue` as a light tiebreaker). Drop discipline and city from the key.
2. **Normalise dates to ISO on both sides** before comparing (store has mixed formats).
3. When two rows are the same event with different discipline tags, **union the disciplines** onto one card instead of losing one — filters keep working.
4. For **cross-source near-dups** (same event, different wording): a fuzzy pass within the same date that **flags to the review queue**, never auto-merges (matches "nothing auto-publishes").
5. Add **freshness** handling (`last_verified` + drop/hide past rows) as the paired P1 — it's the larger live-quality issue.

Drop-in implementation written: `dedup_key.py` (corrected `dedup_key` + `norm_date` + `is_near_dup` + `merge_disciplines`), tested green on the three real cases above.

## Open question from the handoff brief — now resolved
The brief's "where are events actually stored?" (guessed: JSON in the GitHub repo) is answered by the checklist: **the store is the `זוזו אירועים` Google Sheet, served to Vercel via Apps Script.** So `upsert()` targets the **Sheet** (append with `approved=FALSE`), same place the scraper writes — not the repo.

## Still needs a decision before wiring `upsert()`
**Runtime for the newsletter pipeline: Apps Script vs Python.**
- *Apps Script:* upsert = `SpreadsheetApp.appendRow`; lives next to the existing scraper; no new infra; but the `llm_extract`/OCR parts are clunkier there.
- *Python (in Cowork):* upsert = Sheets API (or POST to the same Apps Script web-app endpoint the scraper uses); the parsing/LLM code stays as-is; needs a runner/creds.

## Verification notes
- Site serves live: `https://zuzu.today` returns the calendar app (title "zuzu — איפה רוקדים היום?"), filters + day-selector present, no error/empty state. Event rows load dynamically (not in initial HTML).
- **Could not** confirm the Vercel dashboard "DNS green" — the connected Vercel account (`danalonama-gmailcom's projects`) has **0 projects**, so zuzu is under a different Vercel login/Claude Design. Needs the right account to check the dashboard dot.
