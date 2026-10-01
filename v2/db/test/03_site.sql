-- The site's read function: ranges, weekly rules, children, skipped dates, contact fallback.
\set QUIET on
create or replace function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;
truncate events, event_hosts, event_keys, source_records, duplicate_candidates,
         hosts, host_aliases, venues, venue_aliases restart identity cascade;

insert into hosts (name, kind, phone) values ('Deep Contact', 'org', '052-1111111');
insert into hosts (name, kind, org_id) values ('Ruth Aharoni', 'person', 1);
insert into venues (name, city) values ('סטודיו תנע', 'עין שמר');

-- weekend retreat, no children → every day of the range
insert into events (title, date_start, date_end, status, canonical_key, venue_id, time_start, link)
values ('ריטריט', '2026-10-15', '2026-10-17', 'live', '', 1, '10:00', 'https://x.org/r');
-- 4-week Tuesday course with skipped 2026-10-27; first session is the open class (a child)
insert into events (title, date_start, date_end, weekdays, skip_dates, time_start, venue_id, status, canonical_key)
values ('קורס קונטקט', '2026-10-13', '2026-11-03', '{2}', '{2026-10-27}', '19:00', 1, 'live', '');
insert into events (title, parent_id, date_start, time_start, open_session, venue_id, status, canonical_key)
values ('שיעור פתוח', 2, '2026-10-13', '19:00', true, 1, 'live', '');
insert into event_hosts values (2, 2, 0), (3, 2, 0);

select pg_temp.eq((select array_agg(day order by day) from site_events('2026-10-01', '2026-10-31') where event_id = 1),
                  array['2026-10-15','2026-10-16','2026-10-17']::date[], 'retreat shows every day');
select pg_temp.eq((select array_agg(day order by day) from site_events('2026-10-01', '2026-11-30') where event_id = 2),
                  array['2026-10-20','2026-11-03']::date[], 'course: Tuesdays, minus the child day and the skipped day');
select pg_temp.eq((select parent_title from site_events('2026-10-13', '2026-10-13') where event_id = 3),
                  'קורס קונטקט', 'child labeled with parent');
-- B2: no listing contact → the host has none → the host's organization
select pg_temp.eq((select phone || ' ' || contact_source from site_events('2026-10-20', '2026-10-20') where event_id = 2),
                  '052-1111111 org', 'contact falls back to the organization');
select pg_temp.eq((select contact_source from site_events('2026-10-15', '2026-10-15') where event_id = 1),
                  'listing', 'listing contact wins');
-- D5: region is derived from the venue's city
select pg_temp.eq((select region_label from site_events('2026-10-15', '2026-10-15') where event_id = 1),
                  'פרדס חנה והסביבה', 'region from city');
-- D10: complete vs incomplete
insert into events (title, date_start, status, canonical_key) values ('פרטים בקרוב', '2026-10-15', 'live', '');
select pg_temp.eq((select incomplete from site_events('2026-10-15', '2026-10-15') where event_id = 4), true, 'incomplete flagged');
select pg_temp.eq((select incomplete from site_events('2026-10-15', '2026-10-15') where event_id = 1), false, 'complete');

-- hidden parent hides its children; drafts never show
update events set status = 'hidden', hidden_until = '2026-10-14' where id = 2;
select pg_temp.eq((select count(*) from site_events('2026-10-13', '2026-10-13')), 0::bigint, 'hidden parent hides child');

-- G1 lifecycle
select daily_maintenance();
select pg_temp.eq((select status::text from events where id = 2),
                  case when current_date > '2026-11-03' then 'past'
                       when current_date > '2026-10-14' then 'live' else 'hidden' end, 'hidden → live / past');
select pg_temp.eq((select count(*) from site_events('2026-01-01', '2027-12-31')), 0::bigint, 'range over a year → nothing');
\echo ok
