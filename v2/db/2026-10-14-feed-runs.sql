-- Feeds (v2): a record of every run, so a source that silently stops working is noticed.
-- Written by the Vercel feed functions with the service key; the public (anon) key can't read or write it.
-- Safe to re-run.
begin;
create table if not exists public.feed_runs (
  id         bigint generated always as identity primary key,
  source     text not null,
  ran_at     timestamptz not null default now(),
  dry_run    boolean not null default true,
  ok         boolean not null,
  counts     jsonb not null default '{}'::jsonb,
  report     jsonb,
  error      text
);
create index if not exists feed_runs_source_ran_at on public.feed_runs (source, ran_at desc);
alter table public.feed_runs enable row level security;   -- no policies: only the service key gets in
commit;

-- Live fix (found 14.10): the Tuesday Tel Aviv Deep Contact course had its times reversed (21:30–19:00).
-- The source title says "ימי שלישי 19:00-21:30". Only touches that one row, and only if still reversed.
update public.events
   set time_start = '19:00', time_end = '21:30'
 where id = '5d460ef3-55ff-4f25-996d-161fd538ea7d'
   and time_start = '21:30' and time_end = '19:00';

-- Check: one row, 19:00:00 / 21:30:00
select title, time_start, time_end from public.events where id = '5d460ef3-55ff-4f25-996d-161fd538ea7d';
