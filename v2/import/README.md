# v2/import — the one-time move from the v1 Google Sheet

Every v1 row goes through the same `ingest()` the feeds will use, so the import is also the
first real test of the v2 duplicate rules.

## Run it

1. **Database ready:** migrations `0001`–`0006` + both `seed/` files applied (see `../db/README.md`).
2. **Load the import functions:** run `v1_import.sql` once (Supabase SQL Editor, or psql).
3. **Download the sheet:** Google Sheets → *zuzu-events* → File → Download → Microsoft Excel (.xlsx).
4. **Convert it** (needs Python 3 and `pip install openpyxl`):
   ```
   python3 v2/import/v1_to_sql.py zuzu-events.xlsx > v2/import/v1_import_data.sql
   ```
   The output holds names and phone numbers. It is git-ignored; don't share it.
5. **Run the output** against the database, preferably with psql and the connection string from
   Supabase (Project → Connect):
   ```
   psql "postgresql://…" -v ON_ERROR_STOP=1 -f v2/import/v1_import_data.sql
   ```
   It is one transaction: either everything is imported or nothing is. The last statement prints
   a report. The file is ~850 KB; whether the Supabase SQL Editor accepts a file that size is untested.

Run it on a database with **no events yet**. To refresh closer to the switch-over, reset the
tables and run it again; it is not built to be layered on top of an earlier import.

## What it does

| v1 | v2 |
|---|---|
| `approved` TRUE | live (past dates become `past` at the end) |
| `review` rejected | rejected, with the `reason` |
| neither | draft |
| `repeat` weekly (+ `count` / `date_end`) | weekly rule; no end → open-ended with a 3-month horizon |
| `repeat` biweekly / monthly, `dates` column | explicit dates (`occurrence_dates`) |
| `teachers` "1.9=name; 8.9=name" | one child event per dated teacher |
| `category` / `type` | style / format codes (e.g. קונטקט → contact_improv); "נשים בלבד" / "גברים בלבד" → audience |
| `host`, `venue`/`city`/`region` | directory entries (hosts, venues, city → region) |
| *venues* tab | venues with their city; unknown cities learn their region |
| *teachers* tab | host phones (a bodyways listing URL is not kept as the teacher's link) |
| *corrections* tab | host/venue spellings learned as aliases — only when the two names look alike |

When two v1 rows turn out to be one event: an approved copy beats a rejected one, live beats draft.
At the end, "same event?" questions where either side is past or rejected are closed as history.

## Result on the sheet as of 3.10.2026 (local Postgres)

| | |
|---|---|
| rows | 627 → 609 events created, 1 auto-merged, 2 unchanged, 9 matched a rejected copy, 6 invalid (no date) |
| events | 162 live, 14 draft, 229 past, 204 rejected, + 40 teacher-rotation children |
| directory | 343 hosts, 227 venues, every city mapped to a region (after `seed/0002_towns_2026-10.sql`) |
| "same event?" questions | 33 open (114 more were about past/rejected events and were closed) |
| next 60 days vs v1 | every one of v1's 699 day-cards is in v2; v2 adds 7 that v1 loses to bugs (below), plus the extra days of multi-day events (C1) |

v1 bugs this surfaced (v1 replayed from `apps-script/zuzu-events.gs`; the live feed couldn't be
fetched from the build environment). Titles are left out of the repo on purpose.
- An approved row whose `date_end` is months *before* its `date_start` (day and month swapped):
  v1 hides it; v2 drops the bad end date, shows the event and leaves a note for review.
- A `dates` cell separated by "·": v1 can't read it, so those sessions don't show; v2 can.
- A second, pending row with a swapped end date.
- 6 rows with no date at all (they are recorded as invalid, not imported as events).

## Tests

`python3 v2/import/test_v1_to_sql.py` (conversion) and `sh v2/db/test/run.sh` (includes
`04_occurrences_and_v1_import.sql`).
