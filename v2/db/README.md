# v2/db — the Supabase database

Everything the site, the bot and the feeds share lives here, in SQL. The canonical key,
duplicate detection and ingest are database functions, so there is one implementation.

| File | What |
|---|---|
| `migrations/0001_schema.sql` | Tables, enums, row-level security (nothing public by default) |
| `migrations/0002_normalize_and_key.sql` | `norm_text`, `norm_title`, `parse_time`, `norm_phone`, `norm_link`, `canonical_key` |
| `migrations/0003_dedup.sql` | `event_for_key`, `find_duplicate_candidates`, `merge_events`, `merge_preview`, `dismiss_duplicate` |
| `migrations/0005_occurrence_dates.sql` | Explicit date lists, series-aware key and duplicate checks, bad end dates dropped with a note |
| `migrations/0004_ingest_and_read.sql` | `ingest` (every source calls it), `site_events` (the site's only public call), `daily_maintenance`, the bot's views |
| `seed/0001_seed.sql` | Regions, city → region map (from v1), sources with v1's publish policy |
| `test/` | `sh test/run.sh` builds a throwaway DB and runs the tests (real cases from the v1 sheet) |

The v1 import lives in `../import/`.

## Apply to Supabase

1. Supabase dashboard → your project → **SQL Editor**.
2. Paste and run, in this order: `0001`, `0002`, `0003`, `0004`, `0005`, then `seed/0001_seed.sql` and `seed/0002_towns_2026-10.sql`.
   (Already ran 0001–0004? Just run `0005`; it works on a database that has data.)
3. Check: `select * from site_events(current_date, current_date + 7);` returns no error (and no rows yet).
4. Daily housekeeping: enable the `pg_cron` extension (Database → Extensions), then run
   `select cron.schedule('zuzu-daily', '5 0 * * *', 'select daily_maintenance()');`

Run these on an empty project. The migrations are not written to be re-run on top of themselves.

## Who can call what

- **anon key** (the public site): only `site_events(from, to)`. Every table is behind RLS with no policies.
- **service role** (the bot, feed cron, import; never in the browser): everything.

## Tested on

Local Postgres 16 with pg_trgm. **Not yet run on a real Supabase project.**
Supabase keeps extensions in an `extensions` schema; the migrations use that.
