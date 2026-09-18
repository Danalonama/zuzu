# Zuzu — tagging-learning loop, week of 2026-08-23

Source: Dana ran `correctionsSummary()` and pasted the log + the full current `zuzu-events.gs` (1279-line version, has a `count` column).

STATUS: edits applied to the real file and delivered as the complete `zuzu-events.gs` (passes node --check). Awaiting Dana's paste + redeploy.

## What the corrections actually showed
The fixes are mostly the extractor **dropping structured fields**, not mis-tagging disciplines/regions. Real (old≠new) fixes, ranked:
- `repeat: "" → "weekly"` ×16 — biggest. Root cause: the `_scan()` prompt never asks for `repeat`, so it's always blank.
- `url: "#" → …` — Movement Freaks ×6, Deep Contact ×2. Teacher directory back-fills url by *host*, but these arrive with inconsistent/empty host so it misses them.
- phone `"" → "503010073"` ×7 and `"" → "+972 52-445-4907"` ×5.
- `city "" → תל אביב` ×3, `venue "" → האחים מסלוויטה 7` ×2.
- `category: חקר תנועה → קונטקט` ×2 — Deep Contact event, not a general pattern.

Not present: no region corrections, no rejections (the corrections tab logs edits to *approved* rows only).

## Source directory (Dana, 2026-08-23)
- **Movement Freaks** = Stas Kazanovitz. Phone `+972 52-445-4907`, url `https://movementfreaks.com/` (homepage — fills when url empty/#).
- **Deep Contact** = owned by Saar & Sasha; teachers: Ruth Aharoni, Atar Shilo, Rotem Ram, Ran Ben Dror, Mandy Michaeli (all matched HE+EN). Phone `0503010073` (fills unless the listing has its own). **No default url** — Deep Contact courses/workshops each have their own page, so url is left to the specific link captured in review (via review_enrich / add-from-link). Old corrections had the phone as `503010073` w/o leading zero — stored proper `0503010073`.
Both live in the `SOURCE_LINKS` map (objects: match + optional url + optional phone), applied in `_submitEvent` via `_sourceProfile()`. No `addTeacher` lines needed.

## Correction to an earlier wrong claim
First pass I said the logger records unchanged fields. Wrong — `_review()` already skips unchanged fields. The identical-looking date/time rows in the summary are a **display artifact**: the corrections tab's from/to columns get coerced to Date cells, so `correctionsSummary()` prints two different originals as the same "Thu Aug 27 2026…" text. (~90% confident; confirm against the raw tab.)

## Changes made to zuzu-events.gs (final file delivered)
1. DISCIPLINE_RULES: added `deep\s*contact` → קונטקט.
2. VENUE_REGION: added `'האחים מסלוויטה':'תל אביב'`.
3. New `SOURCE_LINKS` (objects) + `_sourceProfile()`, applied in `_submitEvent` — fills empty/`#` url AND blank phone for the two sources above (MF: url+phone; Deep Contact: phone only).
4. `_scan()` prompt: added `repeat` to the JSON schema + a rule to return "weekly" only on explicit weekly language (one-off workshops/jams stay blank). **Fix for the 16× repeat gap.**
5. (no code change — `_submitEvent` already reads `data.repeat`.)
6. `correctionsSummary()`: format Date cells + skip coerced-identical rows so future summaries aren't polluted.

Run-once after saving: `addVenue('האחים מסלוויטה 7','תל אביב','תל אביב')`, then `retagDisciplines()`, `retagRegions()`, `applyTeacherContacts()`. Redeploy vg0way as New version.

## Deliberately NOT encoded (too thin / risky)
- Blanket `repeat ""→weekly` default (would mislabel one-offs) — used explicit-signal detection instead.
- Global `חקר תנועה → קונטקט` remap (genuine discipline overlap; tied to Deep Contact only).
- `type ""→שיעור` default (2×, weak) and host-name normalization (נפתלי → נפתלי בר יוסף) — left to Dana.

## Watch-outs
- A Deep Contact teacher who also teaches elsewhere with a bare listing would get the Deep Contact phone. Only fills blanks, and Dana reviews everything, so catchable. Tighten (require "deep contact" nearby) if it happens.

## Open for Dana
- Review queue status (was ~119 pending) + any review-page tweaks.
