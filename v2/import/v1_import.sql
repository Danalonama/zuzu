-- zuzu v2 — functions for the one-time import of the v1 Google Sheet.
-- Load once (after migrations 0001–0005 + seed), then run the SQL that v1_to_sql.py generates.
-- Every row goes through ingest(), so the import exercises exactly the dedup the feeds will use.

-- venues tab: name | city | region
create or replace function v1_import_venue(p_name text, p_city text, p_region text) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  v_id := resolve_venue(jsonb_build_object('name', p_name, 'city', p_city, 'region', p_region));
  -- the venues tab knows a city the first sighting didn't
  if v_id is not null and nullif(btrim(p_city), '') is not null then
    insert into cities (name, region_code)
    values (btrim(p_city), (select code from regions where label_he = btrim(p_region)))
    on conflict (name) do update set region_code = coalesce(cities.region_code, excluded.region_code);
    update venues set city = btrim(p_city), region_code = null
      where id = v_id and city is null and kind in ('studio', 'outdoor');
  end if;
  return v_id;
end $$;

-- teachers tab: name | phone | url. The url is often just the bodyways listing it was
-- first seen on, which is not the teacher's own link, so those are skipped.
create or replace function v1_import_teacher(p_name text, p_phone text, p_url text) returns void
language plpgsql as $$
declare ids bigint[];
begin
  ids := resolve_hosts(array[p_name]);
  if cardinality(ids) <> 1 then return; end if;          -- "A, B": no shared phone
  update hosts set
    phone = coalesce(phone, norm_phone(p_phone)),
    link  = coalesce(link, case when p_url !~* 'bodyways\.org/event' then norm_link(p_url) end)
  where id = ids[1];
end $$;

-- corrections tab: field | from | to. A host/venue correction teaches the directory that
-- `from` means `to` (E3) — but only when the two look alike ("הדר רון - תנועה וריקוד" →
-- "הדר רון"). A correction that replaced one real person with another is not an alias.
create or replace function v1_learn_correction(p_field text, p_from text, p_to text) returns text
language plpgsql as $$
declare
  f text := norm_text(p_from);
  t text := norm_text(p_to);
  v_id bigint;
begin
  if p_field not in ('host', 'venue') or f = '' or t = '' or f = t then return 'skipped'; end if;
  if not (extensions.similarity(f, t) >= 0.4 or position(t in f) > 0 or position(f in t) > 0) then
    return 'not alike';
  end if;
  if p_field = 'host' then
    if exists (select 1 from host_aliases where alias_norm = f) then return 'known'; end if;
    v_id := (resolve_hosts(array[p_to]))[1];
    if v_id is null then return 'skipped'; end if;
    insert into host_aliases (alias_norm, host_id) values (f, v_id) on conflict do nothing;
  else
    if exists (select 1 from venue_aliases where alias_norm = f) then return 'known'; end if;
    v_id := resolve_venue(jsonb_build_object('name', p_to));
    if v_id is null then return 'skipped'; end if;
    insert into venue_aliases (alias_norm, venue_id) values (f, v_id) on conflict do nothing;
  end if;
  return 'learned';
end $$;

-- One events-tab row.
--   meta: {uid, status: live|draft|rejected, reason, open_ended, last_verified,
--          rotation: [{date, host}], row: {...the original cells}}
--   x:    the extraction, in ingest()'s format
-- Status when copies of one event disagree: an approved copy wins over a rejected one
-- (v1 sometimes approved a twin after rejecting the first), live wins over draft.
create or replace function v1_import_row(meta jsonb, x jsonb) returns jsonb
language plpgsql as $$
declare
  r       jsonb;
  v_id    bigint;
  v_st    text := meta->>'status';
  cur     event_status;
  kids    int := 0;
  k       jsonb;
  pkey    text;
  cr      jsonb;
begin
  r := ingest('v1', meta->>'uid', null, meta->'row', x);
  v_id := (r->>'event_id')::bigint;
  if v_id is null then return r; end if;
  select status into cur from events where id = v_id;

  if r->>'outcome' = 'created' then
    update events set status = v_st::event_status,
                      reject_reason = case when v_st = 'rejected' then nullif(meta->>'reason', '') end
      where id = v_id;
  elsif v_st = 'live' and cur in ('draft', 'rejected') then
    update events set status = 'live', reject_reason = null where id = v_id;
    if cur = 'rejected' then
      update source_records set note = 'v1: approved copy of a rejected event → made live'
        where id = (r->>'record_id')::bigint;
    end if;
  end if;

  if (meta->>'open_ended')::boolean then
    update events set open_ended = true where id = v_id;
  end if;
  if meta ? 'last_verified' then
    update events set last_verified = greatest(last_verified, (meta->>'last_verified')::timestamptz)
      where id = v_id;
  end if;

  -- teacher rotation → one child per dated teacher (C1+C2: "a monthly teacher override")
  select status, canonical_key into cur, pkey from events where id = v_id;
  if cur <> 'rejected' and jsonb_typeof(meta->'rotation') = 'array' then
    for k in select * from jsonb_array_elements(meta->'rotation') loop
      cr := ingest('v1', (meta->>'uid') || ':' || (k->>'date'), null, k,
                   (x - 'weekdays' - 'occurrence_dates' - 'date_end' - 'hosts')
                   || jsonb_build_object('date_start', k->>'date', 'hosts', jsonb_build_array(k->>'host'),
                                         'parent_key', pkey));
      if (cr->>'event_id') is not null then
        update events set status = cur, parent_id = v_id
          where id = (cr->>'event_id')::bigint and id <> v_id and status in ('draft', 'live');
        kids := kids + 1;
      end if;
    end loop;
  end if;
  return r || jsonb_build_object('children', kids);
end $$;

-- What the import did, in numbers.
create or replace function v1_import_report() returns table (metric text, value bigint)
language sql stable as $$
  select 'sheet rows read', count(*) from source_records where source_id = 'v1' and external_id !~ ':'
  union all
  select 'outcome: ' || outcome, count(*) from source_records
    where source_id = 'v1' and external_id !~ ':' group by outcome
  union all
  select 'events: ' || status, count(*) from events where parent_id is null group by status
  union all
  select 'child events (teacher rotation)', count(*) from events where parent_id is not null
  union all
  select 'open "same event?" questions', count(*) from duplicate_candidates where status = 'open'
  union all
  select 'hosts in directory', count(*) from hosts
  union all
  select 'host spellings known (aliases)', count(*) from host_aliases
  union all
  select 'venues in directory', count(*) from venues
  union all
  select 'cities without a region', count(*) from cities where region_code is null
  union all
  select 'live + upcoming events (next 60 days, per day)', count(*)
    from site_events(current_date, current_date + 60)
$$;

-- After all rows: mark past events, then close "same event?" questions that are history —
-- where either side is already past or was rejected in v1. Only questions about two
-- live/draft events stay open for the bot.
create or replace function v1_import_finish() returns jsonb
language plpgsql as $$
declare m jsonb; n int;
begin
  m := daily_maintenance();
  update duplicate_candidates d set status = 'dismissed', decided_at = now()
  from events a, events b
  where d.status = 'open' and a.id = d.event_a and b.id = d.event_b
    and (a.status not in ('live', 'draft') or b.status not in ('live', 'draft'));
  get diagnostics n = row_count;
  return m || jsonb_build_object('history_questions_closed', n);
end $$;
