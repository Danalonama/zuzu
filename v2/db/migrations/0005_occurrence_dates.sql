-- zuzu v2 — 0005: what the v1 sheet needs that 0001–0004 didn't have.
--
-- 1. occurrence_dates: "occurs on exactly these dates". v1 has biweekly, monthly and
--    explicit date lists (courses, "18.9, 19.9" …); a weekday rule can't express those.
-- 2. Series vs. single in the key: a weekly/range event and a one-day event on its first
--    day are different things, so the series key gets a "|series" suffix and they never
--    collide. (This also lets a teacher-rotation child sit on its parent's first day.)
--    A single class that matches a day of a series is still caught, and only ever asked.
-- 3. A venue whose city is unknown may still carry a region (many v1 rows have only that).
-- 4. A city the seed doesn't know learns its region from the first source that has one.
--
-- Safe to run on a database that already has 0001–0004.

alter table events add column occurrence_dates date[] not null default '{}';
alter table events add constraint one_kind_of_rule
  check (weekdays is null or occurrence_dates = '{}');

alter table venues drop constraint venue_region_only_when_disclosed_later;
alter table venues add constraint venue_region_only_without_city
  check (region_code is null or city is null);

-- True for a weekly rule, an explicit date list, or a multi-day range.
create function is_series(d_start date, d_end date, weekdays smallint[], occ date[]) returns boolean
language sql immutable parallel safe as $$
  select weekdays is not null or coalesce(cardinality(occ), 0) > 0
         or (d_end is not null and d_end > d_start)
$$;

create function event_key(d date, title text, venue_id bigint, t time, series boolean) returns text
language sql immutable parallel safe as $$
  select canonical_key(d, title, venue_id, t) || case when series then '|series' else '' end
$$;

-- Does an event with this shape take place on day d?
create function occurs_on(d date, d_start date, d_end date, weekdays smallint[], occ date[], skip date[])
returns boolean
language sql immutable parallel safe as $$
  select not (d = any(coalesce(skip, '{}')))
     and case
           when coalesce(cardinality(occ), 0) > 0 then d = any(occ)
           else d between d_start and coalesce(d_end, d_start)
                and (weekdays is null or extract(dow from d)::smallint = any(weekdays))
         end
$$;

create or replace function events_before_write() returns trigger language plpgsql as $$
begin
  if new.weekdays = '{}' then new.weekdays := null; end if;
  new.occurrence_dates := coalesce((select array_agg(distinct x order by x)
                                    from unnest(new.occurrence_dates) x), '{}');
  if new.occurrence_dates <> '{}' then
    new.date_start := new.occurrence_dates[1];
    new.date_end   := new.occurrence_dates[cardinality(new.occurrence_dates)];
  end if;
  if new.weekdays is not null and new.date_end is null then
    new.date_end := greatest(new.date_start, current_date) + interval '3 months';
    new.open_ended := true;
  end if;
  new.weekdays    := (select array_agg(distinct x order by x) from unnest(new.weekdays) x);
  new.disciplines := coalesce((select array_agg(distinct btrim(x) order by btrim(x))
                               from unnest(new.disciplines) x where btrim(x) <> ''), '{}');
  new.formats     := coalesce((select array_agg(distinct btrim(x) order by btrim(x))
                               from unnest(new.formats) x where btrim(x) <> ''), '{}');
  new.audience    := coalesce((select array_agg(distinct x order by x) from unnest(new.audience) x), '{}');
  new.skip_dates  := coalesce((select array_agg(distinct x order by x) from unnest(new.skip_dates) x), '{}');
  new.canonical_key := event_key(new.date_start, new.title, new.venue_id, new.time_start,
                                 is_series(new.date_start, new.date_end, new.weekdays, new.occurrence_dates));
  return new;
end $$;

drop function find_duplicate_candidates(date, time, bigint, bigint[], text, bigint);

-- As in 0003, plus: explicit date lists count as occurring, and an automatic merge needs
-- both sides to be single-day events (a single class vs. a day of a series is only asked).
create function find_duplicate_candidates(
  p_date date, p_time time, p_venue_id bigint, p_host_ids bigint[], p_title text,
  p_exclude bigint default null, p_series boolean default false
) returns table (event_id bigint, reason text, auto boolean, score real)
language sql stable as $$
  with c as (
    select e.id, e.status,
           (p_time is not null and e.time_start = p_time)          as same_time,
           (p_time is not null and e.time_start is not null and e.time_start <> p_time) as diff_time,
           (p_venue_id is not null and e.venue_id = p_venue_id)    as same_venue,
           (coalesce(cardinality(p_host_ids), 0) > 0 and exists (
              select 1 from event_hosts eh where eh.event_id = e.id and eh.host_id = any(p_host_ids)))
                                                                    as same_host,
           extensions.similarity(norm_title(e.title), norm_title(p_title)) as sim,
           (e.date_start = p_date and not p_series
            and not is_series(e.date_start, e.date_end, e.weekdays, e.occurrence_dates)) as both_single
    from events e
    where e.status <> 'merged'
      and (e.date_start = p_date
           or occurs_on(p_date, e.date_start, e.date_end, e.weekdays, e.occurrence_dates, e.skip_dates))
      and e.id is distinct from p_exclude
  ), r as (
    select id, sim,
           case
             when same_time and same_venue and same_host then 'same date, time, venue and host'
             when same_time and same_venue               then 'same date, time and venue'
             when same_time and same_host                then 'same date, time and host'
             when (same_venue or same_host) and sim >= 0.4 and not diff_time
               then 'same date and ' || case when same_venue then 'venue' else 'host' end || ', similar title'
           end as reason,
           (same_time and same_venue and same_host and both_single) as auto
    from c
  )
  select id, reason, auto, sim from r where reason is not null
  order by auto desc, sim desc, id
$$;

create or replace function resolve_venue(p jsonb) returns bigint
language plpgsql as $$
declare
  v_name    text := nullif(btrim(p->>'name'), '');
  v_city    text := nullif(btrim(p->>'city'), '');
  v_kind    venue_kind := case when p->>'kind' in ('studio','outdoor','online','disclosed_later','abroad')
                               then (p->>'kind')::venue_kind end;
  v_region  text := nullif(btrim(p->>'region'), '');
  v_country text := nullif(btrim(p->>'country'), '');
  v_all     text := norm_text(concat_ws(' ', v_name, v_city, v_region));
  v_id      bigint;
begin
  if v_kind is null then
    v_kind := case
      when v_all ~ '(^| )(זום|zoom|אונליין|online)( |$)' then 'online'
      when v_country is not null or v_region ~ '^חו.?ל$' then 'abroad'
      else 'studio' end;
  end if;
  if v_kind = 'online' then
    v_name := coalesce(v_name, 'אונליין');
    v_city := null;
  end if;
  v_name := coalesce(v_name, v_city);
  if v_name is null then return null; end if;

  select venue_id into v_id from venue_aliases where alias_norm = norm_text(v_name);
  if v_id is not null then return v_id; end if;

  if v_kind not in ('studio', 'outdoor') then v_city := null; end if;
  if v_city is not null then
    -- a city we haven't mapped yet learns its region from the first source that knows it
    insert into cities (name, region_code)
    values (v_city, (select code from regions where label_he = v_region or code = v_region))
    on conflict (name) do update set region_code = coalesce(cities.region_code, excluded.region_code);
  end if;
  insert into venues (name, kind, city, region_code, country)
  values (v_name, v_kind, v_city,
          case when v_city is null and v_kind in ('studio', 'outdoor', 'disclosed_later')
               then (select code from regions where label_he = v_region or code = v_region) end,
          case when v_kind = 'abroad' then v_country end)
  returning id into v_id;
  perform learn_venue_alias(v_name, v_id);
  return v_id;
end $$;

-- ingest: as in 0004, plus occurrence_dates (extraction key) and the series-aware key/candidates.
create or replace function ingest(p_source text, p_external_id text, p_raw_text text, p_raw jsonb, p_extraction jsonb)
returns jsonb
language plpgsql as $$
declare
  x        jsonb := p_extraction;
  src      sources;
  v_hash   text := md5(coalesce(p_raw_text, '') || '|' || coalesce(p_raw::text, '') || '|' || x::text);
  v_rec    bigint;
  v_prev   source_records;
  n        events;
  v_hosts  bigint[];
  v_target bigint;
  t        events;
  v_auto   boolean := false;
  v_cands  jsonb := '[]';
  v_conf   jsonb := '{}';
  v_out    text;
  v_newkey text;
  c        record;
  v_note   text;
begin
  select * into src from sources where id = p_source and active;
  if src.id is null then raise exception 'unknown or inactive source %', p_source; end if;

  -- the same item from the same feed, unchanged: it is still out there (G2)
  if p_external_id is not null then
    select * into v_prev from source_records
    where source_id = p_source and external_id = p_external_id and content_hash = v_hash;
    if v_prev.id is not null then
      update source_records set last_seen_at = now(), times_seen = times_seen + 1 where id = v_prev.id;
      update events set last_verified = now()
        where id = v_prev.event_id and status not in ('merged', 'rejected');
      return jsonb_build_object('outcome', 'seen_again', 'event_id', v_prev.event_id,
                                'record_id', v_prev.id, 'candidates', '[]'::jsonb);
    end if;
  end if;

  -- build the incoming event
  n.title       := nullif(btrim(x->>'title'), '');
  begin
    n.date_start := (x->>'date_start')::date;
    n.date_end   := nullif(x->>'date_end', '')::date;
  exception when others then
    n.date_start := null;
  end;

  if n.title is null or n.date_start is null then
    insert into source_records (source_id, external_id, content_hash, raw_text, raw, extraction, outcome, note)
    values (p_source, p_external_id, v_hash, p_raw_text, p_raw, x, 'invalid', 'missing title or date_start')
    returning id into v_rec;
    if v_note is not null then
      update source_records set note = concat_ws('; ', note, v_note) where id = v_rec;
    end if;
    return jsonb_build_object('outcome', 'invalid', 'event_id', null, 'record_id', v_rec, 'candidates', '[]'::jsonb);
  end if;

  n.lang         := coalesce(nullif(x->>'lang', ''),
                             case when n.title ~ '[א-ת]' then 'he' else 'en' end);
  n.description  := nullif(btrim(x->>'description'), '');
  n.weekdays     := (select array_agg(v::smallint) from jsonb_array_elements_text(
                       case when jsonb_typeof(x->'weekdays') = 'array' then x->'weekdays' else '[]' end) v
                     where v ~ '^[0-6]$');
  n.skip_dates   := coalesce((select array_agg(v::date) from jsonb_array_elements_text(
                              case when jsonb_typeof(x->'skip_dates') = 'array' then x->'skip_dates' else '[]' end) v
                              where v ~ '^\d{4}-\d{2}-\d{2}$'), '{}');
  n.occurrence_dates := coalesce((select array_agg(v::date) from jsonb_array_elements_text(
                              case when jsonb_typeof(x->'occurrence_dates') = 'array' then x->'occurrence_dates' else '[]' end) v
                              where v ~ '^\d{4}-\d{2}-\d{2}$'), '{}');
  if n.occurrence_dates <> '{}' then
    n.weekdays := null;
    n.date_start := (select min(v) from unnest(n.occurrence_dates) v);
    n.date_end   := (select max(v) from unnest(n.occurrence_dates) v);
  end if;
  if n.date_end < n.date_start then
    v_note := 'date_end ' || n.date_end || ' is before date_start ' || n.date_start
              || ' (day/month swapped?): dropped';
    n.date_end := null;
  end if;
  n.time_start   := parse_time(x->>'time_start');
  n.time_end     := parse_time(x->>'time_end');
  n.disciplines  := jtext_array(x->'disciplines');
  n.formats      := jtext_array(x->'formats');
  -- unknown values are dropped here (they stay in source_records.extraction)
  n.audience     := array(select a from unnest(jtext_array(x->'audience')) a
                          where a = any(array['women_only','men_only','beginners','parents_kids','60_plus']));
  n.link         := norm_link(x->>'link');
  n.phone        := norm_phone(x->>'phone');
  n.price_text   := nullif(btrim(x->>'price_text'), '');
  n.price_min    := case when x->>'price_min' ~ '^\d{1,6}$' then (x->>'price_min')::int end;
  n.price_max    := case when x->>'price_max' ~ '^\d{1,6}$' then (x->>'price_max')::int end;
  if n.price_max < n.price_min then n.price_max := null; end if;
  n.open_session := coalesce((x->>'open_session')::boolean, false);
  n.venue_id     := resolve_venue(case when jsonb_typeof(x->'venue') = 'object' then x->'venue'
                                       else jsonb_build_object('name', x->>'venue', 'city', x->>'city',
                                                               'region', x->>'region') end);
  if x ? 'parent_key' then n.parent_id := event_for_key(x->>'parent_key'); end if;
  v_hosts := resolve_hosts(jtext_array(x->'hosts'));

  -- F1: exact key, then F2: candidates
  v_target := event_for_key(event_key(n.date_start, n.title, n.venue_id, n.time_start,
                                      is_series(n.date_start, n.date_end, n.weekdays, n.occurrence_dates)));
  if v_target is null then
    for c in select * from find_duplicate_candidates(n.date_start, n.time_start, n.venue_id, v_hosts, n.title, null,
                                                     is_series(n.date_start, n.date_end, n.weekdays, n.occurrence_dates)) loop
      if c.auto and v_target is null then
        v_target := c.event_id;
        v_auto := true;
      else
        v_cands := v_cands || jsonb_build_object('event_id', c.event_id, 'reason', c.reason, 'score', c.score);
      end if;
    end loop;
  end if;

  if v_target is not null then
    select * into t from events where id = v_target for update;

    if t.status = 'rejected' then
      insert into source_records (source_id, external_id, content_hash, raw_text, raw, extraction, event_id, outcome)
      values (p_source, p_external_id, v_hash, p_raw_text, p_raw, x, v_target, 'skipped_rejected')
      returning id into v_rec;
    if v_note is not null then
      update source_records set note = concat_ws('; ', note, v_note) where id = v_rec;
    end if;
      return jsonb_build_object('outcome', 'skipped_rejected', 'event_id', v_target,
                                'record_id', v_rec, 'candidates', '[]'::jsonb);
    end if;

    -- E3: what the feed says differently from what we kept (shown to you, never applied)
    select coalesce(jsonb_object_agg(k, jsonb_build_object('kept', kept, 'incoming', incoming)), '{}')
      into v_conf
    from (values
      ('title',      t.title,                  n.title),
      ('time_start', t.time_start::text,       n.time_start::text),
      ('time_end',   t.time_end::text,         n.time_end::text),
      ('date_end',   t.date_end::text,         n.date_end::text),
      ('venue_id',   t.venue_id::text,         n.venue_id::text),
      ('link',       t.link,                   n.link),
      ('phone',      t.phone,                  n.phone),
      ('price_text', t.price_text,             n.price_text)
    ) f(k, kept, incoming)
    where kept is not null and incoming is not null and kept <> incoming;

    -- filling a blank time/venue changes the key; never let that collide with another event
    v_newkey := event_key(t.date_start, t.title, coalesce(t.venue_id, n.venue_id),
                          coalesce(t.time_start, n.time_start),
                          is_series(t.date_start, t.date_end, t.weekdays, t.occurrence_dates));
    if v_newkey <> t.canonical_key and coalesce(event_for_key(v_newkey), v_target) <> v_target then
      n.venue_id := null;
      n.time_start := null;
      v_conf := v_conf || jsonb_build_object('_note', 'time/venue not filled: would collide with event '
                                                      || event_for_key(v_newkey));
    end if;

    update events e set
      description  = coalesce(e.description, n.description),
      date_end     = coalesce(e.date_end, n.date_end),
      weekdays     = case when e.occurrence_dates = '{}' then coalesce(e.weekdays, n.weekdays) end,
      occurrence_dates = case when e.weekdays is null and e.occurrence_dates = '{}'
                              then n.occurrence_dates else e.occurrence_dates end,
      time_start   = coalesce(e.time_start, n.time_start),
      time_end     = coalesce(e.time_end, n.time_end),
      venue_id     = coalesce(e.venue_id, n.venue_id),
      link         = coalesce(e.link, n.link),
      phone        = coalesce(e.phone, n.phone),
      price_text   = coalesce(e.price_text, n.price_text),
      price_min    = coalesce(e.price_min, n.price_min),
      price_max    = coalesce(e.price_max, n.price_max),
      parent_id    = coalesce(e.parent_id, n.parent_id),
      open_session = e.open_session or n.open_session,
      disciplines  = e.disciplines || n.disciplines,     -- D1: union, never a second event
      formats      = e.formats || n.formats,
      audience     = e.audience || n.audience,
      skip_dates   = e.skip_dates || n.skip_dates,
      last_verified = now()
    where e.id = v_target;

    if not exists (select 1 from event_hosts where event_id = v_target) then
      insert into event_hosts (event_id, host_id, position)
        select v_target, h, i::smallint - 1 from unnest(v_hosts) with ordinality u(h, i);
    end if;

    v_out := case
      when v_auto then 'merged'
      when exists (select 1 from events e where e.id = v_target
                   and (e.description, e.date_end, e.weekdays, e.occurrence_dates, e.time_start, e.time_end, e.venue_id,
                        e.link, e.phone, e.price_text, e.price_min, e.price_max, e.parent_id,
                        e.open_session, e.disciplines, e.formats, e.audience, e.skip_dates)
                       is distinct from
                       (t.description, t.date_end, t.weekdays, t.occurrence_dates, t.time_start, t.time_end, t.venue_id,
                        t.link, t.phone, t.price_text, t.price_min, t.price_max, t.parent_id,
                        t.open_session, t.disciplines, t.formats, t.audience, t.skip_dates))
        then 'filled'
      else 'unchanged' end;

    insert into source_records (source_id, external_id, content_hash, raw_text, raw, extraction,
                                event_id, outcome, conflicts)
    values (p_source, p_external_id, v_hash, p_raw_text, p_raw, x, v_target, v_out,
            nullif(v_conf, '{}'))
    returning id into v_rec;
    if v_note is not null then
      update source_records set note = concat_ws('; ', note, v_note) where id = v_rec;
    end if;
    return jsonb_build_object('outcome', v_out, 'event_id', v_target, 'record_id', v_rec,
                              'candidates', '[]'::jsonb);
  end if;

  -- a new event. Possible duplicates never go live on their own, even from an auto source.
  n.status := case when src.auto_publish and v_cands = '[]' then 'live' else 'draft' end;
  n.last_verified := now();
  insert into events (parent_id, title, lang, description, date_start, date_end, weekdays, occurrence_dates, skip_dates,
                      time_start, time_end, open_session, disciplines, formats, audience, venue_id,
                      link, phone, price_text, price_min, price_max, status, last_verified, canonical_key)
  values (n.parent_id, n.title, n.lang, n.description, n.date_start, n.date_end, n.weekdays, n.occurrence_dates, n.skip_dates,
          n.time_start, n.time_end, n.open_session, n.disciplines, n.formats, n.audience, n.venue_id,
          n.link, n.phone, n.price_text, n.price_min, n.price_max, n.status, n.last_verified, '')
  returning * into n;

  insert into event_hosts (event_id, host_id, position)
    select n.id, h, i::smallint - 1 from unnest(v_hosts) with ordinality u(h, i);

  insert into duplicate_candidates (event_a, event_b, reason, score)
    select (c2->>'event_id')::bigint, n.id, c2->>'reason', (c2->>'score')::real
    from jsonb_array_elements(v_cands) c2
    on conflict do nothing;

  insert into source_records (source_id, external_id, content_hash, raw_text, raw, extraction, event_id, outcome)
  values (p_source, p_external_id, v_hash, p_raw_text, p_raw, x, n.id, 'created')
  returning id into v_rec;
    if v_note is not null then
      update source_records set note = concat_ws('; ', note, v_note) where id = v_rec;
    end if;

  return jsonb_build_object('outcome', 'created', 'event_id', n.id, 'record_id', v_rec, 'candidates', v_cands);
end $$;

create or replace function site_events(p_from date, p_to date)
returns table (
  day date, event_id bigint, parent_id bigint, title text, parent_title text, lang text,
  time_start time, time_end time, date_start date, date_end date, open_ended boolean,
  open_session boolean, disciplines text[], formats text[], audience text[],
  venue_name text, venue_kind venue_kind, city text, region_code text, region_label text, country text,
  hosts text[], link text, phone text, contact_source text, price_text text, incomplete boolean
)
language sql stable security definer set search_path = public, extensions as $$
  with live as (
    select e.* from events e
    left join events p on p.id = e.parent_id
    where e.status = 'live' and (e.parent_id is null or p.status = 'live')
      and e.date_start <= p_to and coalesce(e.date_end, e.date_start) >= p_from
  ), days as (
    select l.id, d::date as day
    from live l, generate_series(greatest(l.date_start, p_from), least(coalesce(l.date_end, l.date_start), p_to),
                                 interval '1 day') d
    where occurs_on(d::date, l.date_start, l.date_end, l.weekdays, l.occurrence_dates, l.skip_dates)
  ), shown as (
    select x.* from days x
    where not exists (select 1 from days c join live ch on ch.id = c.id
                      where ch.parent_id = x.id and c.day = x.day)
  ), contact as (
    select e.id,
           h.link as h_link, h.phone as h_phone, o.link as o_link, o.phone as o_phone
    from live e
    left join lateral (select hh.* from event_hosts eh join hosts hh on hh.id = eh.host_id
                       where eh.event_id = e.id and (hh.link is not null or hh.phone is not null)
                       order by eh.position limit 1) h on true
    left join lateral (select oo.* from event_hosts eh join hosts hh on hh.id = eh.host_id
                       join hosts oo on oo.id = hh.org_id
                       where eh.event_id = e.id and (oo.link is not null or oo.phone is not null)
                       order by eh.position limit 1) o on true
  )
  select s.day, e.id, e.parent_id, e.title, p.title, e.lang,
         e.time_start, e.time_end, e.date_start, e.date_end, e.open_ended,
         e.open_session, e.disciplines, e.formats, e.audience,
         v.name, v.kind, v.city, r.code, r.label_he, v.country,
         (select coalesce(array_agg(h.name order by eh.position, h.name), '{}')
            from event_hosts eh join hosts h on h.id = eh.host_id where eh.event_id = e.id),
         case when e.link is not null or e.phone is not null then e.link
              when ct.h_link is not null or ct.h_phone is not null then ct.h_link
              else ct.o_link end,
         case when e.link is not null or e.phone is not null then e.phone
              when ct.h_link is not null or ct.h_phone is not null then ct.h_phone
              else ct.o_phone end,
         case when e.link is not null or e.phone is not null then 'listing'
              when ct.h_link is not null or ct.h_phone is not null then 'host'
              when ct.o_link is not null or ct.o_phone is not null then 'org' end,
         e.price_text,
         -- D10: live but missing something
         (e.venue_id is null or e.time_start is null
          or coalesce(e.link, e.phone, ct.h_link, ct.h_phone, ct.o_link, ct.o_phone) is null)
  from shown s
  join events e on e.id = s.id
  left join events p on p.id = e.parent_id
  left join venues v on v.id = e.venue_id
  left join cities ci on ci.name = v.city
  left join regions r on r.code = coalesce(ci.region_code, v.region_code)
  left join contact ct on ct.id = e.id
  where p_to >= p_from and p_to - p_from <= 366
  order by s.day, e.time_start nulls last, e.title
$$;

-- Recompute every existing key with the series suffix (no-op on an empty database).
update events set title = title;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p
           where p.pronamespace = 'public'::regnamespace loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
grant execute on function site_events(date, date) to public;
