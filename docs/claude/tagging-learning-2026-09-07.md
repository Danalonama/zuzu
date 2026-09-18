# Zuzu — tagging-learning loop, week of 2026-09-07

Source: this week I read the live `corrections` + `events` tabs **directly from the `zuzu-events` Google
Sheet via the Drive connector** (Sheet id `1VtznRC2ZQwpXwex6dKfZhxRphbpBujaWFql4xp1S3E4`, last modified
2026-09-07) — no paste from Dana needed. 356 correction rows, 14 rejected rows.

STATUS: analysis delivered to Dana as `zuzu-tagging-rules-2026-09-07.md`. No code edited this week — see
"why" below. Awaiting Dana on the deploy of last week's file + a re-paste if she wants the new rules folded in.

## Headline finding
`repeat "" → weekly` corrections grew **16 (2026-08-23) → 20 now** = 4 new manual repeat fixes since last
week. If last week's `_scan()` repeat fix were deployed, those would auto-populate and never hit the
corrections tab. Phone corrections (`503010073` ×7, `+972 52-445-4907` ×5) are unchanged from last week too.
Strong evidence that **last week's edited `zuzu-events.gs` was never pasted + redeployed.** Can't confirm from
here (the deployed .gs isn't visible via Drive), but the priority is: deploy last week's file first.

## New rules identified this week (small deltas to fold into last week's file)
1. `CITY_REGION` add `'בת ים':'תל אביב'` — 3× `city "" → בת ים`.
2. `CITY_REGION` add `'בית לחם הגלילית':'צפון'` + `VENUE_REGION` `'יער המאכל':'צפון'` — 2× venue fill.
3. `VENUE_REGION` add spelling variant `'האחים מאסלויטה':'תל אביב'` — corrections use מאסלויטה (extra alef);
   last week's key was מסלוויטה, so a substring match misses the variant.
4. (low-conf, 1×) `region פרדס חנה והסביבה → שרון` — leave unless it recurs.

Category corrections remain per-event discipline *unions* — not encodable (same as last week). Deep Contact
`חקר תנועה → קונטקט` ×2 already covered by last week's DISCIPLINE_RULES.

## Rejections → auto-drop (task item 3)
Only 14 rejected rows, free-typed reasons, thin. Buckets: not-movement/dance ×4, past/stale date ×3,
missing-details ×3, duplicate ×3 (already auto), kids ×1. Only safe automation now = **past-date drop/hide**
(also to-do #7 freshness) — but must NOT drop `repeat=weekly` rows on a single past date (roll forward, don't
kill live weekly classes). Not-movement blocklist: hold until there's a title-labeled sample (~15-20); keep
logging rejections with title.

## Extraction bugs spotted (not tagging rules)
- `time 12/30/1899 → :8:30`: `12/30/1899` = Sheets epoch for a time-only value; target has stray leading
  colon. Time-field parse bug; likely part of the large `time` (81) correction count.
- Corrections-logging alignment: a few rows logged `ARAZI` ×3 / `שיעור ניסיון` ×2 in the `field` column
  (title/host leaked into field slot). Last week's `correctionsSummary()` cleanup should help once deployed.

## Why no code edited this week
The deployed `zuzu-events.gs` is not readable from here (Apps Script project, not a Drive doc), and last
week's already-delivered file covers the top patterns. Right move was to confirm the patterns persist +
surface the new deltas, not blind-edit a file I can't see. If Dana re-pastes the current file, produce a full
updated `zuzu-events.gs` folding rules 1-3.

## Open for Dana
- Deploy last week's file (the real unblock).
- Review queue status (was ~119) + review-page tweaks?
- Re-paste deployed .gs if she wants rules 1-3 folded into a fresh full file.
