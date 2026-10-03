-- 0005 (explicit dates, series key) and the v1 import functions.
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
create temp table r (name text primary key, res jsonb);

-- ---- explicit dates (v1 biweekly / dates column): only those days, range set from them
insert into r select 'bi', ingest('manual', null, null, null,
  '{"title":"קונטקט דו-שבועי","date_start":"2026-11-01","occurrence_dates":["2026-11-15","2026-11-01","2026-11-29"],
    "time_start":"19:00","venue":{"name":"גפן","city":"עין שמר"}}');
update events set status = 'live';
select pg_temp.eq((select array_agg(day order by day) from site_events('2026-11-01', '2026-11-30')),
                  array['2026-11-01','2026-11-15','2026-11-29']::date[], 'explicit dates only');
select pg_temp.eq((select date_end from events where id = 1), '2026-11-29'::date, 'range from the dates');

-- ---- a single class on a series day: never auto-merged, asked
insert into r select 'one', ingest('manual', null, null, null,
  '{"title":"קונטקט דו-שבועי","date_start":"2026-11-15","time_start":"19:00","venue":{"name":"גפן"}}');
select pg_temp.eq((select res->>'outcome' from r where name='one'), 'created', 'single vs series: separate');
select pg_temp.eq((select jsonb_array_length(res->'candidates') from r where name='one'), 1, '… and asked');

-- ---- end before start (v1: 5.10 → 10.5) is dropped with a note, not a crash
insert into r select 'swap', ingest('manual', null, null, null,
  '{"title":"קבוצת דוגמה","date_start":"2026-10-05","date_end":"2026-05-10"}');
select pg_temp.eq((select date_end from events where id = (select (res->>'event_id')::bigint from r where name='swap')),
                  null::date, 'bad end dropped');
select pg_temp.eq((select note like 'date_end 2026-05-10 is before%' from source_records
                   where id = (select (res->>'record_id')::bigint from r where name='swap')), true, 'noted');

-- ---- v1 import: rejected first, approved twin later → live (an approved twin of a rejected row)
insert into r select 'p1', v1_import_row('{"uid":"a1","status":"rejected","reason":"לא בישראל","rotation":[]}',
  '{"title":"Island retreat","date_start":"2026-11-14","date_end":"2026-11-18","venue":{"name":"Crete","region":"חו״ל"}}');
select pg_temp.eq((select status::text from events where id = (select (res->>'event_id')::bigint from r where name='p1')),
                  'rejected', 'rejected row → rejected');
insert into r select 'p2', v1_import_row('{"uid":"a2","status":"live","rotation":[]}',
  '{"title":"Island retreat","date_start":"2026-11-14","date_end":"2026-11-18","venue":{"name":"Crete","region":"חו״ל"}}');
select pg_temp.eq((select status::text from events where id = (select (res->>'event_id')::bigint from r where name='p1')),
                  'live', 'approved twin wins');

-- ---- v1 import: teacher rotation → children, one per dated teacher, incl. the first day
insert into r select 'rot', v1_import_row(
  '{"uid":"g1","status":"live","rotation":[{"date":"2026-11-03","host":"נוגה בר"},{"date":"2026-11-10","host":"טל אמיר"}]}',
  '{"title":"שיעור גאגא","date_start":"2026-11-03","weekdays":[2],"date_end":"2026-11-24","time_start":"19:15",
    "venue":{"name":"סטודיו לנוע","city":"פרדס חנה"}}');
select pg_temp.eq((select (res->>'children')::int from r where name='rot'), 2, 'two children');
select pg_temp.eq((select string_agg(day || ' ' || coalesce(hosts[1], '-'), ', ' order by day)
                   from site_events('2026-11-01', '2026-11-30') where title = 'שיעור גאגא'),
                  '2026-11-03 נוגה בר, 2026-11-10 טל אמיר, 2026-11-17 -, 2026-11-24 -',
                  'children replace the parent on their days');

-- ---- corrections tab: alike → alias; a different person → not an alias
select pg_temp.eq(v1_learn_correction('host', 'הדר רון - תנועה וריקוד גוף נפש', 'הדר רון'), 'learned', 'alike');
select pg_temp.eq(v1_learn_correction('host', 'סטודיו גפן', 'אורי שחר'), 'not alike', 'different person');
select pg_temp.eq((select h.name from host_aliases a join hosts h on h.id = a.host_id
                   where a.alias_norm = norm_text('הדר רון - תנועה וריקוד גוף נפש')), 'הדר רון', 'alias points right');

-- ---- teachers tab: bodyways listing URL is not the teacher's link; phone is recovered
select v1_import_teacher('ליאת גל', '501234567', 'https://www.bodyways.org/event/30407/x');
select pg_temp.eq((select phone || '|' || coalesce(link, '') from hosts where name = 'ליאת גל'),
                  '050-1234567|', 'teacher phone, no bodyways link');

-- ---- venues tab teaches a city its region
select v1_import_venue('בית העם מכמורת', 'מכמורת', 'שרון');
select pg_temp.eq((select region_code from cities where name = 'מכמורת'), 'sharon', 'city learns region');
\echo ok
