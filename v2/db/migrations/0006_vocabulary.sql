-- zuzu v2 — 0006: vocabulary for styles (disciplines) and formats (A1, approved 3.10.2026).
--
-- Events store stable English codes; the site shows the Hebrew label, which can change any
-- time without touching data. Every spelling a source has used maps to one code through
-- vocab_aliases (Hebrew label, variants like "חקר התנועה", and the code itself).
-- A word no alias knows is not lost: it becomes a *pending* vocabulary entry the bot can
-- later approve, rename or fold into an existing code (vocab_merge).
--
-- Safe to run on a database that already has events: their values are converted below.

create table vocab (
  kind      text not null check (kind in ('discipline', 'format')),
  code      text not null,
  label_he  text not null,
  approved  boolean not null default true,
  sort      smallint not null default 100,
  primary key (kind, code)
);

create table vocab_aliases (
  kind        text not null,
  alias_norm  text not null,
  code        text not null,
  primary key (kind, alias_norm),
  foreign key (kind, code) references vocab (kind, code) on update cascade
);

alter table vocab enable row level security;
alter table vocab_aliases enable row level security;

insert into vocab (kind, code, label_he, sort) values
  ('discipline', 'dance',             'מחול',          1),
  ('discipline', 'contact_improv',    'קונטקט',        2),
  ('discipline', 'free_dance',        'ריקוד חופשי',   3),
  ('discipline', 'ecstatic_dance',    'אקסטטיק',       4),
  ('discipline', 'improvisation',     'אימפרוביזציה',  5),
  ('discipline', 'movement_research', 'חקר תנועה',     6),
  ('discipline', 'gaga',              'גאגא',          7),
  ('discipline', 'biodanza',          'ביודנסה',       8),
  ('discipline', 'movement',          'מובמנט',        9),
  ('discipline', 'nia',               'ניה',          10),
  ('discipline', 'womens_circle',     'מעגל נשים',    11),
  ('discipline', 'belly_dance',       'ריקודי בטן',   12),
  ('discipline', 'acro',              'אקרו',         13),
  ('discipline', 'other',             'אחר',          99),
  ('format', 'class',       'שיעור',     1),
  ('format', 'workshop',    'סדנה',      2),
  ('format', 'course',      'קורס',      3),
  ('format', 'party',       'מסיבה',     4),
  ('format', 'event',       'אירוע',     5),
  ('format', 'jam',         'ג''אם',     6),
  ('format', 'retreat',     'ריטריט',    7),
  ('format', 'performance', 'מופע',      8),
  ('format', 'intensive',   'אינטנסיב',  9),
  ('format', 'journey',     'מסע',      10),
  ('format', 'gathering',   'מפגש',     11),
  ('format', 'program',     'תוכנית',   12);

-- every label and every code is its own alias
insert into vocab_aliases (kind, alias_norm, code)
  select kind, norm_text(label_he), code from vocab
  union
  select kind, norm_text(replace(code, '_', ' ')), code from vocab;

-- the variants approved on 3.10
insert into vocab_aliases (kind, alias_norm, code) values
  ('discipline', norm_text('חקר התנועה'),  'movement_research'),
  ('format',     norm_text('מסיבה/ריקוד'), 'party'),
  ('format',     norm_text('הופעה'),       'performance')
on conflict do nothing;

-- Words → codes. Unknown words become pending entries (approved = false), so nothing is lost.
create function vocab_codes(p_kind text, p_words text[]) returns text[]
language plpgsql as $$
declare
  w text;
  n text;
  c text;
  out text[] := '{}';
begin
  foreach w in array coalesce(p_words, '{}') loop
    n := norm_text(w);
    continue when n = '';
    select code into c from vocab_aliases where kind = p_kind and alias_norm = n;
    if c is null then
      c := 'new_' || replace(n, ' ', '_');
      insert into vocab (kind, code, label_he, approved) values (p_kind, c, btrim(w), false)
        on conflict do nothing;
      insert into vocab_aliases (kind, alias_norm, code) values (p_kind, n, c)
        on conflict do nothing;
    end if;
    if not c = any(out) then out := out || c; end if;
  end loop;
  return out;
end $$;

-- The bot's "this new word means X": fold pending code `p_from` into `p_into` everywhere.
create function vocab_merge(p_kind text, p_from text, p_into text) returns void
language plpgsql as $$
begin
  update vocab_aliases set code = p_into where kind = p_kind and code = p_from;
  if p_kind = 'discipline' then
    update events set disciplines = array_replace(disciplines, p_from, p_into)
      where p_from = any(disciplines);
  else
    update events set formats = array_replace(formats, p_from, p_into)
      where p_from = any(formats);
  end if;
  delete from vocab where kind = p_kind and code = p_from;
end $$;

create function vocab_labels(p_kind text, p_codes text[]) returns text[]
language sql stable as $$
  select coalesce(array_agg(coalesce(v.label_he, c) order by v.sort nulls last, c), '{}')
  from unnest(p_codes) c left join vocab v on v.kind = p_kind and v.code = c
$$;

-- existing events (an earlier import): Hebrew words → codes
update events set disciplines = vocab_codes('discipline', disciplines),
                  formats     = vocab_codes('format', formats)
  where disciplines <> '{}' or formats <> '{}';

-- ingest: as in 0005, with styles and formats mapped to codes.
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
  n.disciplines  := vocab_codes('discipline', jtext_array(x->'disciplines'));
  n.formats      := vocab_codes('format', jtext_array(x->'formats'));
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

-- site_events: as in 0005, plus the Hebrew labels of styles and formats.
drop view incomplete_live;
drop function site_events(date, date);
create function site_events(p_from date, p_to date)
returns table (
  day date, event_id bigint, parent_id bigint, title text, parent_title text, lang text,
  time_start time, time_end time, date_start date, date_end date, open_ended boolean,
  open_session boolean, disciplines text[], formats text[], audience text[],
  discipline_labels text[], format_labels text[],
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
         vocab_labels('discipline', e.disciplines), vocab_labels('format', e.formats),
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

create view incomplete_live with (security_invoker = true) as
  select distinct on (s.event_id) s.event_id, s.title, s.day as next_day
  from site_events(current_date, current_date + 180) s
  join events e on e.id = s.event_id
  where s.incomplete and e.created_at < now() - interval '7 days'
  order by s.event_id, s.day;

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
