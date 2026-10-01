-- zuzu v2 — duplicates: candidates (F2) and merging (F3).

-- Every key an event has ever had. When you correct a title or time in the bot the key
-- changes, but the next arrival of the original version must still find this event.
create table event_keys (
  canonical_key  text primary key,
  event_id       bigint not null references events(id)
);
alter table event_keys enable row level security;

create function events_remember_key() returns trigger language plpgsql as $$
begin
  insert into event_keys (canonical_key, event_id) values (new.canonical_key, new.id)
  on conflict (canonical_key) do nothing;
  return null;
end $$;

create trigger events_remember_key after insert or update of canonical_key on events
  for each row execute function events_remember_key();

-- The event a key belongs to: an event that has it now, else one that had it before;
-- merges are followed to the surviving event.
create function event_for_key(p_key text) returns bigint
language plpgsql stable as $$
declare v_id bigint;
begin
  select id into v_id from events where canonical_key = p_key and status <> 'merged';
  if v_id is null then
    select event_id into v_id from event_keys where canonical_key = p_key;
  end if;
  while v_id is not null loop
    exit when not exists (select 1 from events where id = v_id and status = 'merged');
    select merged_into into v_id from events where id = v_id;
  end loop;
  return v_id;
end $$;

-- F2, as agreed 1.10:
--   auto  — same date + same start time + same venue + a shared host   → merged without asking
--   ("same date" also covers a day a weekly/range event runs on — those are only ever asked)
--   ask   — same date + same start time + (same venue OR a shared host)
--   ask   — same date + (same venue OR a shared host) + similar title,
--           unless both start times are known and differ (Suzanne Dellal: Gaga 08:30 ≠ Gaga 19:00)
-- Venue and host are directory ids, so spellings only match once the directory knows them
-- (aliases). Rejected events are included on purpose: a near-copy of something you rejected
-- is exactly the Paros case.
create function find_duplicate_candidates(
  p_date date, p_time time, p_venue_id bigint, p_host_ids bigint[], p_title text,
  p_exclude bigint default null
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
           (e.date_start = p_date) as same_start
    from events e
    where e.status <> 'merged'
      and (e.date_start = p_date
           -- or a range / weekly event that occurs on p_date
           or (e.date_end is not null and p_date between e.date_start and e.date_end
               and (e.weekdays is null or extract(dow from p_date)::smallint = any(e.weekdays))
               and not (p_date = any(e.skip_dates))))
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
           -- only a same-day single event is merged automatically; an occurrence of a
           -- weekly/range event is always asked about
           (same_time and same_venue and same_host and same_start) as auto
    from c
  )
  select id, reason, auto, sim from r where reason is not null
  order by auto desc, sim desc, id
$$;

-- F3: fold `p_drop` into `p_keep`. Most-complete wins per field (longer text wins),
-- sets are unioned, hosts/children/source records move over, the dropped event is kept
-- as status 'merged'. Returns the surviving event id.
create function merge_events(p_keep bigint, p_drop bigint) returns bigint
language plpgsql as $$
declare
  k events;
  d events;
begin
  if p_keep = p_drop then raise exception 'cannot merge an event into itself'; end if;
  select * into k from events where id = p_keep for update;
  select * into d from events where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'event not found'; end if;
  if k.status in ('merged', 'rejected') then
    raise exception 'cannot merge into event % (status %)', k.id, k.status;
  end if;
  if d.status = 'merged' then raise exception 'event % is already merged', d.id; end if;

  -- retire the dropped event first, so its key is free for the survivor
  update events set status = 'merged', merged_into = p_keep where id = p_drop;

  update events e set
    description   = case when length(coalesce(d.description, '')) > length(coalesce(k.description, ''))
                         then d.description else k.description end,
    price_text    = case when length(coalesce(d.price_text, '')) > length(coalesce(k.price_text, ''))
                         then d.price_text else k.price_text end,
    date_end      = coalesce(k.date_end, d.date_end),
    weekdays      = coalesce(k.weekdays, d.weekdays),
    time_start    = coalesce(k.time_start, d.time_start),
    time_end      = coalesce(k.time_end, d.time_end),
    venue_id      = coalesce(k.venue_id, d.venue_id),
    link          = coalesce(k.link, d.link),
    phone         = coalesce(k.phone, d.phone),
    price_min     = coalesce(k.price_min, d.price_min),
    price_max     = coalesce(k.price_max, d.price_max),
    parent_id     = coalesce(k.parent_id, nullif(d.parent_id, p_keep)),
    open_session  = k.open_session or d.open_session,
    disciplines   = k.disciplines || d.disciplines,
    formats       = k.formats || d.formats,
    audience      = k.audience || d.audience,
    skip_dates    = k.skip_dates || d.skip_dates,
    -- if either side was already public, the survivor is public
    status        = case when k.status = 'draft' and d.status = 'live' then 'live'::event_status
                         else k.status end,
    last_verified = greatest(k.last_verified, d.last_verified)
  where e.id = p_keep;

  insert into event_hosts (event_id, host_id, position)
    select p_keep, host_id, position + 100 from event_hosts where event_id = p_drop
    on conflict do nothing;
  update events set parent_id = p_keep where parent_id = p_drop and id <> p_keep;
  update source_records set event_id = p_keep where event_id = p_drop;

  -- questions about this pair are answered; questions about the dropped event move over
  update duplicate_candidates set status = 'merged', decided_at = now()
    where status = 'open' and least(event_a, event_b) = least(p_keep, p_drop)
                          and greatest(event_a, event_b) = greatest(p_keep, p_drop);
  update duplicate_candidates dc set event_a = p_keep
    where dc.status = 'open' and dc.event_a = p_drop and dc.event_b <> p_keep
      and not exists (select 1 from duplicate_candidates x
                      where least(x.event_a, x.event_b) = least(p_keep, dc.event_b)
                        and greatest(x.event_a, x.event_b) = greatest(p_keep, dc.event_b));
  update duplicate_candidates dc set event_b = p_keep
    where dc.status = 'open' and dc.event_b = p_drop and dc.event_a <> p_keep
      and not exists (select 1 from duplicate_candidates x
                      where least(x.event_a, x.event_b) = least(p_keep, dc.event_a)
                        and greatest(x.event_a, x.event_b) = greatest(p_keep, dc.event_a));
  update duplicate_candidates set status = 'merged', decided_at = now()
    where status = 'open' and (event_a = p_drop or event_b = p_drop);

  return p_keep;
end $$;

-- F3: "you see the merged result before confirming". Runs the merge, captures the result,
-- rolls it back.
create function merge_preview(p_keep bigint, p_drop bigint) returns jsonb
language plpgsql as $$
declare v jsonb;
begin
  begin
    perform merge_events(p_keep, p_drop);
    select to_jsonb(e) || jsonb_build_object('hosts',
             (select coalesce(jsonb_agg(h.name order by eh.position, h.name), '[]')
              from event_hosts eh join hosts h on h.id = eh.host_id where eh.event_id = e.id))
      into v from events e where e.id = p_keep;
    raise exception using errcode = 'ZZ999', message = 'preview rollback';
  exception when sqlstate 'ZZ999' then
    return v;
  end;
end $$;

-- The bot's "not the same" answer.
create function dismiss_duplicate(p_candidate bigint) returns void
language sql as $$
  update duplicate_candidates set status = 'dismissed', decided_at = now()
  where id = p_candidate and status = 'open'
$$;
