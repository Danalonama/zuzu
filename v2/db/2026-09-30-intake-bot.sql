-- zuzu v2 · Telegram intake bot support.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- 1. Venue aliases (hosts already have them). The bot matches venue names against name + aliases,
--    so every spelling merged away (תנע / סטודיו תנע, בואנה / בוא'נה, …) should be kept here.
alter table public.venues add column if not exists aliases text[] not null default '{}';

-- 2. One row per forwarded message: raw text + Claude's output kept untouched (decision E4),
--    plus the proposals and their review state. Only the service_role (the bot) can touch it:
--    RLS is on and there are no policies.
create table if not exists public.intake_drafts (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  telegram_update_id  bigint unique,          -- Telegram re-delivers on errors; unique = handled once
  chat_id             bigint not null,
  source_message_id   bigint,
  summary_message_id  bigint,
  raw_text            text not null,
  extraction          jsonb,                  -- Claude's structured output, as returned
  items               jsonb not null default '[]'::jsonb,  -- proposals + review state (bot/proposal.js)
  status              text not null default 'processing',  -- processing | open | done | failed
  model               text,
  usage               jsonb,                  -- token usage, for cost tracking
  error               text,
  version             integer not null default 0          -- optimistic lock for concurrent button presses
);
-- Screenshots: Telegram file references ({file_id, media_type, size}); the bot re-downloads them for ✏️ fixes.
alter table public.intake_drafts add column if not exists images jsonb;
alter table public.intake_drafts enable row level security;
revoke all on public.intake_drafts from anon, authenticated;

-- 3. Enum labels of a column (or of an array column's element type), so the bot uses the real
--    price_kind / price_unit / host kind / venue kind values instead of hard-coding them.
create or replace function public.intake_column_enum(tbl text, col text)
returns text[]
language sql stable
set search_path = public, pg_catalog
as $$
  select array_agg(e.enumlabel::text order by e.enumsortorder)
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  join pg_enum e on e.enumtypid = case when t.typcategory = 'A' then t.typelem else t.oid end
  where a.attrelid = to_regclass('public.' || quote_ident(tbl))
    and a.attname = col
    and not a.attisdropped
$$;
revoke execute on function public.intake_column_enum(text, text) from public, anon, authenticated;
grant execute on function public.intake_column_enum(text, text) to service_role;
