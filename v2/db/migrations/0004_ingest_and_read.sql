-- zuzu v2 — directory resolution, ingest (E1–E4), the site's read function, lifecycle (G).

-- ---------------------------------------------------------------- helpers

-- jsonb array or comma-separated string → text[] ("מובמנט, מחול" from v1 still works).
create function jtext_array(j jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}')
  from (
    select jsonb_array_elements_text(j) as x where jsonb_typeof(j) = 'array'
    union all
    select unnest(string_to_array(j #>> '{}', ',')) where jsonb_typeof(j) = 'string'
  ) s
$$;

-- ---------------------------------------------------------------- directory

-- Learn that `p_alias` means this host / venue (E3: "never איל בגר, always איל בנר").
create function learn_host_alias(p_alias text, p_host_id bigint) returns void
language sql as $$
  insert into host_aliases (alias_norm, host_id) values (norm_text(p_alias), p_host_id)
  on conflict (alias_norm) do update set host_id = excluded.host_id
$$;

create function learn_venue_alias(p_alias text, p_venue_id bigint) returns void
language sql as $$
  insert into venue_aliases (alias_norm, venue_id) values (norm_text(p_alias), p_venue_id)
  on conflict (alias_norm) do update set venue_id = excluded.venue_id
$$;

-- Two directory entries turned out to be the same host: move everything to `p_keep`.
create function merge_hosts(p_keep bigint, p_drop bigint) returns void
language plpgsql as $$
begin
  update host_aliases set host_id = p_keep where host_id = p_drop;
  insert into event_hosts (event_id, host_id, position)
    select event_id, p_keep, position from event_hosts where host_id = p_drop
    on conflict do nothing;
  delete from event_hosts where host_id = p_drop;
  update hosts set org_id = p_keep where org_id = p_drop;
  update hosts k set phone = coalesce(k.phone, d.phone), link = coalesce(k.link, d.link),
                     kind = coalesce(k.kind, d.kind), org_id = coalesce(k.org_id, d.org_id)
    from hosts d where k.id = p_keep and d.id = p_drop;
  -- the dropped entry stays (G3) but nothing points at it any more
  perform learn_host_alias((select name from hosts where id = p_drop), p_keep);
end $$;

-- Host names → directory ids, creating unknown hosts. "A, B" and "A / B" are two hosts.
-- A trailing " -" (bodyways: "אלון פורת -") is dropped.
create function resolve_hosts(p_names text[]) returns bigint[]
language plpgsql as $$
declare
  n text;
  v_id bigint;
  ids bigint[] := '{}';
begin
  for n in
    select btrim(regexp_replace(x, '\s*-\s*$', ''))
    from unnest(p_names) a, regexp_split_to_table(a, '\s*[,/&]\s*') x
  loop
    continue when norm_text(n) = '';
    select host_id into v_id from host_aliases where alias_norm = norm_text(n);
    if v_id is null then
      insert into hosts (name) values (n) returning id into v_id;
      perform learn_host_alias(n, v_id);
    end if;
    if not v_id = any(ids) then ids := ids || v_id; end if;
  end loop;
  return ids;
end $$;

-- Venue object → directory id, creating it if unknown.
--   {name, city, kind, region, country}
-- Only a city ("פרדס חנה") → a venue named after the city, so the region is still known.
-- Zoom / אונליין → kind online; חו"ל or a country → kind abroad.
create function resolve_venue(p jsonb) returns bigint
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
    insert into cities (name) values (v_city) on conflict do nothing;
  end if;
  insert into venues (name, kind, city, region_code, country)
  values (v_name, v_kind, v_city,
          case when v_kind = 'disclosed_later'
               then (select code from regions where label_he = v_region or code = v_region) end,
          case when v_kind = 'abroad' then v_country end)
  returning id into v_id;
  perform learn_venue_alias(v_name, v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------- ingest

-- Every source (feeds, inbox, newsletters, the bot's paste box, the v1 import) calls this.
--
-- p_extraction keys (all optional except title + date_start):
--   title, lang, description, date_start, date_end, weekdays[0-6], skip_dates[],
--   time_start, time_end (any format parse_time understands),
--   venue {name, city, kind, region, country}  — or flat venue/city/region,
--   hosts [] or "A, B", disciplines, formats, audience,
--   link, phone, price_text, price_min, price_max, open_session, parent_key
--
-- Result: {outcome, event_id, record_id, candidates:[{event_id, reason, score}]}
--   created          new event (live if the source auto-publishes and nothing looks like a dupe)
--   filled           same event as an existing one; blanks filled (E3: never overwrites)
--   unchanged        same event, nothing new
--   merged           matched an existing event by the auto rule (F2) and folded in
--   skipped_rejected matches a rejected event (E1)
--   seen_again       identical item from this feed again; only last_verified moves (G2)
--   invalid          missing title / date
create function ingest(p_source text, p_external_id text, p_raw_text text, p_raw jsonb, p_extraction jsonb)
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
  v_target := event_for_key(canonical_key(n.date_start, n.title, n.venue_id, n.time_start));
  if v_target is null then
    for c in select * from find_duplicate_candidates(n.date_start, n.time_start, n.venue_id, v_hosts, n.title) loop
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
    v_newkey := canonical_key(t.date_start, t.title, coalesce(t.venue_id, n.venue_id),
                              coalesce(t.time_start, n.time_start));
    if v_newkey <> t.canonical_key and coalesce(event_for_key(v_newkey), v_target) <> v_target then
      n.venue_id := null;
      n.time_start := null;
      v_conf := v_conf || jsonb_build_object('_note', 'time/venue not filled: would collide with event '
                                                      || event_for_key(v_newkey));
    end if;

    update events e set
      description  = coalesce(e.description, n.description),
      date_end     = coalesce(e.date_end, n.date_end),
      weekdays     = coalesce(e.weekdays, n.weekdays),
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
                   and (e.description, e.date_end, e.weekdays, e.time_start, e.time_end, e.venue_id,
                        e.link, e.phone, e.price_text, e.price_min, e.price_max, e.parent_id,
                        e.open_session, e.disciplines, e.formats, e.audience, e.skip_dates)
                       is distinct from
                       (t.description, t.date_end, t.weekdays, t.time_start, t.time_end, t.venue_id,
                        t.link, t.phone, t.price_text, t.price_min, t.price_max, t.parent_id,
                        t.open_session, t.disciplines, t.formats, t.audience, t.skip_dates))
        then 'filled'
      else 'unchanged' end;

    insert into source_records (source_id, external_id, content_hash, raw_text, raw, extraction,
                                event_id, outcome, conflicts)
    values (p_source, p_external_id, v_hash, p_raw_text, p_raw, x, v_target, v_out,
            nullif(v_conf, '{}'))
    returning id into v_rec;
    return jsonb_build_object('outcome', v_out, 'event_id', v_target, 'record_id', v_rec,
                              'candidates', '[]'::jsonb);
  end if;

  -- a new event. Possible duplicates never go live on their own, even from an auto source.
  n.status := case when src.auto_publish and v_cands = '[]' then 'live' else 'draft' end;
  n.last_verified := now();
  insert into events (parent_id, title, lang, description, date_start, date_end, weekdays, skip_dates,
                      time_start, time_end, open_session, disciplines, formats, audience, venue_id,
                      link, phone, price_text, price_min, price_max, status, last_verified, canonical_key)
  values (n.parent_id, n.title, n.lang, n.description, n.date_start, n.date_end, n.weekdays, n.skip_dates,
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

  return jsonb_build_object('outcome', 'created', 'event_id', n.id, 'record_id', v_rec, 'candidates', v_cands);
end $$;

-- ---------------------------------------------------------------- the site

-- Every live event on every day in [p_from, p_to], per the C1+C2 display rule:
--   range covers the day ∧ (no rule ∨ rule's weekday) ∧ day not skipped ∧ no live child that day;
--   plus each child on its own days, labeled with the parent's title.
-- Contact (B2): the listing's own link/phone, else the first host's, else that host's organization.
create function site_events(p_from date, p_to date)
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
    where (l.weekdays is null or extract(dow from d)::smallint = any(l.weekdays))
      and not (d::date = any(l.skip_dates))
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

-- ---------------------------------------------------------------- lifecycle (G1, G2, C3, D10)

-- Run daily (Supabase: pg_cron or a Vercel cron calling it).
create function daily_maintenance() returns jsonb
language plpgsql as $$
declare v_past int; v_unhidden int;
begin
  update events set status = 'past'
    where status = 'live' and coalesce(date_end, date_start) < current_date;
  get diagnostics v_past = row_count;
  update events set status = 'live', hidden_until = null
    where status = 'hidden' and hidden_until < current_date;
  get diagnostics v_unhidden = row_count;
  return jsonb_build_object('marked_past', v_past, 'unhidden', v_unhidden);
end $$;

-- The bot's to-do lists. security_invoker: they obey RLS, so the public API can't read them.
create view review_queue with (security_invoker = true) as
  select e.*, (select count(*) from duplicate_candidates d
               where d.status = 'open' and (d.event_a = e.id or d.event_b = e.id)) as open_duplicates
  from events e where e.status = 'draft'
  order by e.date_start;

create view open_duplicates with (security_invoker = true) as
  select d.*, a.title as title_a, b.title as title_b, a.status as status_a, b.status as status_b
  from duplicate_candidates d join events a on a.id = d.event_a join events b on b.id = d.event_b
  where d.status = 'open';

-- C3: open-ended weekly events reaching their horizon in the next 14 days ("still running?")
create view expiring_rules with (security_invoker = true) as
  select * from events
  where status = 'live' and open_ended and date_end between current_date and current_date + 14;

-- G2: live, not open-ended, not verified for 60 days
create view stale_live with (security_invoker = true) as
  select * from events
  where status = 'live' and not open_ended
    and coalesce(last_verified, created_at) < now() - interval '60 days';

-- D10: live for 7+ days and still missing venue, time or any contact
create view incomplete_live with (security_invoker = true) as
  select distinct on (s.event_id) s.event_id, s.title, s.day as next_day
  from site_events(current_date, current_date + 180) s
  join events e on e.id = s.event_id
  where s.incomplete and e.created_at < now() - interval '7 days'
  order by s.event_id, s.day;

-- E1: rejected events that came back this week (weekly digest)
create view rejected_rearrivals with (security_invoker = true) as
  select r.event_id, e.title, e.reject_reason, count(*) as arrivals, max(r.received_at) as last_arrival
  from source_records r join events e on e.id = r.event_id
  where r.outcome = 'skipped_rejected' and r.received_at > now() - interval '7 days'
  group by r.event_id, e.title, e.reject_reason;

-- ---------------------------------------------------------------- access

-- Only site_events is callable by the public (anon key). Everything else is for the
-- service role, which the bot, the feed cron and the import use.
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
