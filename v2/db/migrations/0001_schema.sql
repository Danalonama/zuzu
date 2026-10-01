-- zuzu v2 — schema.
-- Source of truth for every decision referenced here (A1, B1 …): v2/MODEL.md.
-- Apply in order: 0001 → 0002 → 0003 → 0004, then seed/.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- places (D4, D5)

-- Fixed region list. Region is never entered on an event: it comes from the venue's city.
create table regions (
  code      text primary key,             -- code name, never shown
  label_he  text not null unique,         -- site label, can change any time
  sort      smallint not null default 0
);

-- One row per spelling of a town ("תל אביב", "תל אביב-יפו" …) → its region.
create table cities (
  name         text primary key,
  region_code  text references regions(code)   -- null = not mapped yet (bot asks)
);

create type venue_kind as enum ('studio', 'outdoor', 'online', 'disclosed_later', 'abroad');

create table venues (
  id           bigint generated always as identity primary key,
  name         text not null,
  kind         venue_kind not null default 'studio',
  city         text references cities(name) on update cascade,
  region_code  text references regions(code),  -- only for disclosed_later (region known, place not)
  country      text,                           -- only for abroad
  address      text,
  created_at   timestamptz not null default now(),
  constraint venue_region_only_when_disclosed_later
    check (region_code is null or kind = 'disclosed_later'),
  constraint venue_country_only_when_abroad
    check (country is null or kind = 'abroad')
);

-- Every spelling a source has used for a venue, normalized. Learned on correction (E3).
create table venue_aliases (
  alias_norm  text primary key,
  venue_id    bigint not null references venues(id) on delete cascade
);

-- ---------------------------------------------------------------- hosts (B1, B2)

create type host_kind as enum ('person', 'org');

create table hosts (
  id          bigint generated always as identity primary key,
  name        text not null,
  kind        host_kind,                        -- null = unknown yet (created by ingest)
  org_id      bigint references hosts(id),      -- a person's organization (Ruth Aharoni → Deep Contact)
  phone       text check (phone ~ '^0[0-9]{1,2}-[0-9]{7}$'),
  link        text check (link ~* '^https?://[^[:space:]]+\.[^[:space:]]+'),
  created_at  timestamptz not null default now()
);

-- "איל בגר" → איל בנר forever (E3 follow-up). One alias maps to exactly one host.
create table host_aliases (
  alias_norm  text primary key,
  host_id     bigint not null references hosts(id) on delete cascade
);

-- ---------------------------------------------------------------- sources (E1–E4)

create type source_kind as enum ('tribe', 'ical', 'inbox', 'newsletter', 'scrape', 'manual');

create table sources (
  id            text primary key,               -- 'tribe:gagapeople', 'inbox', 'manual' …
  name          text not null,
  kind          source_kind not null,
  auto_publish  boolean not null default false,  -- E2: new source = review-only until flipped
  active        boolean not null default true,
  config        jsonb not null default '{}'
);

-- ---------------------------------------------------------------- events (C, D, G)

create type event_status as enum (
  'draft',     -- awaiting review
  'live',
  'hidden',    -- suppressed until hidden_until (the מעבר לגוף case)
  'past',      -- set automatically after the last date
  'rejected',
  'merged'     -- folded into merged_into; kept so its key keeps resolving (G3: nothing deleted)
);

create table events (
  id             bigint generated always as identity primary key,
  parent_id      bigint references events(id),   -- C1+C2: class in a retreat, session in a course
  title          text not null check (btrim(title) <> ''),
  lang           text not null default 'he' check (lang in ('he', 'en')),   -- D9
  description    text,

  -- C1+C2: range, optional weekly rule, skipped dates.
  date_start     date not null,
  date_end       date,
  weekdays       smallint[] check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),  -- 0 = Sunday
  open_ended     boolean not null default false, -- "until further notice": date_end is a review horizon (C3)
  skip_dates     date[] not null default '{}',   -- חגים etc.
  time_start     time,                           -- D6: real time, nullable
  time_end       time,
  open_session   boolean not null default false, -- שיעור פתוח / ניסיון

  disciplines    text[] not null default '{}',   -- D1: a set
  formats        text[] not null default '{}',   -- D2: a set
  audience       text[] not null default '{}'    -- D3
                 check (audience <@ array['women_only','men_only','beginners','parents_kids','60_plus']),

  venue_id       bigint references venues(id),
  link           text check (link ~* '^https?://[^[:space:]]+\.[^[:space:]]+'),   -- D8: no '#'
  phone          text check (phone ~ '^0[0-9]{1,2}-[0-9]{7}$'),

  price_text     text,                           -- D7: free text as written
  price_min      integer check (price_min >= 0), -- D7: optional, for stats
  price_max      integer check (price_max >= price_min),

  status         event_status not null default 'draft',
  hidden_until   date,
  reject_reason  text,
  merged_into    bigint references events(id),

  canonical_key  text not null,                  -- F1, computed by trigger (0002)
  last_verified  timestamptz,                    -- G2
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint range_ordered check (date_end is null or date_end >= date_start),
  -- C3: a weekly rule always has an end (default horizon is filled by trigger).
  constraint rule_needs_end check (weekdays is null or date_end is not null),
  constraint hidden_has_date check (status <> 'hidden' or hidden_until is not null),
  constraint merged_has_target check ((status = 'merged') = (merged_into is not null)),
  constraint no_self_parent check (parent_id is distinct from id)
);

-- A merged event keeps its key so later arrivals still resolve to it (via merged_into),
-- so the key is unique only among events that are not merged.
create unique index events_canonical_key_unmerged on events (canonical_key) where status <> 'merged';
create index events_canonical_key on events (canonical_key);
create index events_date_start on events (date_start);
create index events_status on events (status);
create index events_venue on events (venue_id);
create index events_parent on events (parent_id);

-- B1: an event can have several hosts, or none (B3).
create table event_hosts (
  event_id  bigint not null references events(id) on delete cascade,
  host_id   bigint not null references hosts(id),
  position  smallint not null default 0,
  primary key (event_id, host_id)
);
create index event_hosts_host on event_hosts (host_id);

-- E4: every arrival's raw text and the LLM's extraction, untouched, forever.
create table source_records (
  id            bigint generated always as identity primary key,
  source_id     text not null references sources(id),
  external_id   text,                          -- feed item id / message id; null for pastes
  content_hash  text not null,
  raw_text      text,
  raw           jsonb,
  extraction    jsonb not null,
  event_id      bigint references events(id),
  outcome       text not null check (outcome in
                  ('created', 'filled', 'unchanged', 'merged', 'skipped_rejected', 'invalid')),
  conflicts     jsonb,                         -- E3: fields where the feed disagrees with what we kept
  note          text,
  received_at   timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  times_seen    integer not null default 1,
  unique (source_id, external_id, content_hash)
);
create index source_records_event on source_records (event_id);
create index source_records_outcome on source_records (outcome, received_at);

-- F2: "same event?" questions for the bot. Never re-asked once answered.
create table duplicate_candidates (
  id          bigint generated always as identity primary key,
  event_a     bigint not null references events(id),   -- the existing event
  event_b     bigint not null references events(id),   -- the newcomer
  reason      text not null,
  score       real,
  status      text not null default 'open' check (status in ('open', 'merged', 'dismissed')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  check (event_a <> event_b)
);
create unique index duplicate_candidates_pair
  on duplicate_candidates (least(event_a, event_b), greatest(event_a, event_b));

-- ---------------------------------------------------------------- housekeeping

create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger events_touch before update on events
  for each row execute function touch_updated_at();

-- Nothing is readable or writable through the public API by default.
-- The site reads through site_events() (0004); everything else uses the service role.
alter table regions               enable row level security;
alter table cities                enable row level security;
alter table venues                enable row level security;
alter table venue_aliases         enable row level security;
alter table hosts                 enable row level security;
alter table host_aliases          enable row level security;
alter table sources               enable row level security;
alter table events                enable row level security;
alter table event_hosts           enable row level security;
alter table source_records        enable row level security;
alter table duplicate_candidates  enable row level security;
