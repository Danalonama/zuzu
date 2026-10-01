-- Ingest + duplicates, using real duplicate pairs from the v1 sheet (1.10.2026).
\set QUIET on
create or replace function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;
create temp table r (name text primary key, res jsonb);

-- ---- D1: bodyways sends one class once per discipline → one event, disciplines unioned
insert into r select 'bw1', ingest('bodyways', 'bw-31893-a', null, null,
  '{"title":"ביודנסה ריקוד החיים עם נאווה","date_start":"2026-11-16","time_start":"20:00",
    "hosts":["נאוה סופר"],"venue":{"name":"סעדיה גאון","city":"תל אביב-יפו"},"disciplines":["ביודנסה"],"price_text":"350"}');
insert into r select 'bw2', ingest('bodyways', 'bw-31893-b', null, null,
  '{"title":"ביודנסה ריקוד החיים עם נאווה","date_start":"2026-11-16","time_start":"20:00",
    "hosts":["נאוה סופר"],"venue":{"name":"סעדיה גאון","city":"תל אביב-יפו"},"disciplines":["מובמנט"]}');
select pg_temp.eq((select res->>'outcome' from r where name='bw1'), 'created', 'bw1 created');
select pg_temp.eq((select res->>'outcome' from r where name='bw2'), 'filled', 'bw2 folds into bw1');
select pg_temp.eq((select disciplines from events where id = (select (res->>'event_id')::bigint from r where name='bw1')),
                  array['ביודנסה','מובמנט'], 'disciplines unioned');
select pg_temp.eq((select status::text from events where id = (select (res->>'event_id')::bigint from r where name='bw1')),
                  'draft', 'bodyways is review-only (E2)');
select pg_temp.eq((select region_code from cities where name = 'תל אביב-יפו'), 'tel_aviv', 'region from city');

-- ---- G2: the same item again → seen_again, nothing new
insert into r select 'bw1again', ingest('bodyways', 'bw-31893-a', null, null,
  '{"title":"ביודנסה ריקוד החיים עם נאווה","date_start":"2026-11-16","time_start":"20:00",
    "hosts":["נאוה סופר"],"venue":{"name":"סעדיה גאון","city":"תל אביב-יפו"},"disciplines":["ביודנסה"],"price_text":"350"}');
select pg_temp.eq((select res->>'outcome' from r where name='bw1again'), 'seen_again', 'identical re-arrival');
select pg_temp.eq((select times_seen from source_records where external_id = 'bw-31893-a'), 2, 'counted');

-- ---- F2 "ask": קורס Play-Fight — same date, time, host; one copy has no venue → asks, never auto
insert into r select 'pf1', ingest('newsletter', 'nl-1', 'קורס Play-Fight עם איל בנר…', null,
  '{"title":"קורס Play-Fight","date_start":"2026-11-02","time_start":"19:00","hosts":"איל בנר",
    "venue":{"name":"סטודיו תנע עין-שמר","city":"עין-שמר"}}');
insert into r select 'pf2', ingest('manual', null, 'pasted', null,
  '{"title":"קורס PLAY-FIGHT","date_start":"2026-11-02","time_start":"19:00","hosts":"איל בנר"}');
select pg_temp.eq((select res->>'outcome' from r where name='pf2'), 'created', 'pf2 is a new draft');
select pg_temp.eq((select res->'candidates'->0->>'reason' from r where name='pf2'), 'same date, time and host', 'pf2 asks');
select pg_temp.eq((select count(*) from open_duplicates), 1::bigint, 'one open question');

-- ---- E3 follow-up: "never איל בגר, always איל בנר"
select learn_host_alias('איל בגר', (select host_id from host_aliases where alias_norm = norm_text('איל בנר')));
insert into r select 'typo', ingest('manual', null, null, null,
  '{"title":"Play-Fight jam","date_start":"2026-12-01","hosts":"איל בגר"}');
select pg_temp.eq((select array_agg(h.name) from event_hosts eh join hosts h on h.id = eh.host_id
                   where eh.event_id = (select (res->>'event_id')::bigint from r where name='typo')),
                  array['איל בנר'], 'typo resolves to the right host');

-- ---- F2 "auto": יום פתוח — זמן גוף, two wordings, two host spellings, same venue
insert into r select 'zg1', ingest('manual', null, null, null,
  '{"title":"יום פתוח - זמן גוף תכנית תנועה שנתית","date_start":"2026-09-24","time_start":"10:00",
    "hosts":"שירי / מעין","venue":{"name":"סטודיו תנע עין שמר","city":"עין-שמר"}}');
insert into r select 'zg2', ingest('newsletter', 'nl-2', null, null,
  '{"title":"יום פתוח — זמן גוף","date_start":"2026-09-24","time_start":"10:00",
    "hosts":"שירי לוקש, מעין חורש","venue":{"name":"סטודיו תנע עין-שמר"}}');
-- venue spellings already match after normalization; host spellings don't yet → ask, not auto
select pg_temp.eq((select res->'candidates'->0->>'reason' from r where name='zg2'), 'same date, time and venue', 'zg2 asks');
-- you answer once: "שירי" is שירי לוקש. Next time it merges by itself.
select merge_hosts((select host_id from host_aliases where alias_norm = norm_text('שירי לוקש')),
                   (select host_id from host_aliases where alias_norm = norm_text('שירי')));
insert into r select 'zg3', ingest('newsletter', 'nl-3', null, null,
  '{"title":"יום פתוח בזמן גוף","date_start":"2026-09-24","time_start":"10:00",
    "hosts":"שירי","venue":{"name":"סטודיו תנע עין שמר"},"link":"https://www.studiotena.org/zman-guf"}');
select pg_temp.eq((select res->>'outcome' from r where name='zg3'), 'merged', 'zg3 auto-merged');
select pg_temp.eq((select link from events where id = (select (res->>'event_id')::bigint from r where name='zg3')),
                  'https://www.studiotena.org/zman-guf', 'merge filled the missing link');

-- ---- F3: preview shows the result and changes nothing; merge does it
select pg_temp.eq((merge_preview((select (res->>'event_id')::bigint from r where name='pf1'),
                                 (select (res->>'event_id')::bigint from r where name='pf2'))->>'title'),
                  'קורס Play-Fight', 'preview');
select pg_temp.eq((select status::text from events where id = (select (res->>'event_id')::bigint from r where name='pf2')),
                  'draft', 'preview rolled back');
select merge_events((select (res->>'event_id')::bigint from r where name='pf1'),
                    (select (res->>'event_id')::bigint from r where name='pf2'));
select pg_temp.eq((select status::text from events where id = (select (res->>'event_id')::bigint from r where name='pf2')),
                  'merged', 'pf2 merged');
select pg_temp.eq((select count(*) from open_duplicates where event_b = (select (res->>'event_id')::bigint from r where name='pf2')),
                  0::bigint, 'question closed');
-- the merged copy's key still resolves to the survivor
insert into r select 'pf2again', ingest('manual', null, 'pasted again', null,
  '{"title":"קורס PLAY-FIGHT","date_start":"2026-11-02","time_start":"19:00","hosts":"איל בנר"}');
select pg_temp.eq((select (res->>'event_id')::bigint from r where name='pf2again'),
                  (select (res->>'event_id')::bigint from r where name='pf1'), 'merged key follows to survivor');

-- ---- E1: rejection is permanent for the key
update events set status = 'rejected', reject_reason = 'לא בישראל'
  where id = (select (res->>'event_id')::bigint from r where name='typo');
insert into r select 'rej', ingest('newsletter', 'nl-9', null, null,
  '{"title":"Play-Fight jam","date_start":"2026-12-01","hosts":"איל בנר"}');
select pg_temp.eq((select res->>'outcome' from r where name='rej'), 'skipped_rejected', 'rejected key skipped');
select pg_temp.eq((select arrivals from rejected_rearrivals), 1::bigint, 'weekly digest counts it');

-- ---- E3: a title you corrected doesn't come back as a new event
update events set title = 'ביודנסה – ריקוד החיים'
  where id = (select (res->>'event_id')::bigint from r where name='bw1');
insert into r select 'bw3', ingest('bodyways', 'bw-31893-c', null, null,
  '{"title":"ביודנסה ריקוד החיים עם נאווה","date_start":"2026-11-16","time_start":"20:00",
    "venue":{"name":"סעדיה גאון"},"price_text":"300 ש\"ח"}');
select pg_temp.eq((select (res->>'event_id')::bigint from r where name='bw3'),
                  (select (res->>'event_id')::bigint from r where name='bw1'), 'old key still finds the event');
select pg_temp.eq((select title from events where id = (select (res->>'event_id')::bigint from r where name='bw1')),
                  'ביודנסה – ריקוד החיים', 'your title wins');
select pg_temp.eq((select conflicts->'price_text'->>'incoming' from source_records where external_id = 'bw-31893-c'),
                  '300 ש"ח', 'disagreement recorded, not applied');

-- ---- Suzanne Dellal: same name, same venue, same day, different hour → two events, no question
insert into r select 'sd1', ingest('manual', null, null, null,
  '{"title":"גאגא/אנשים","date_start":"2026-10-04","weekdays":[0,2,4],"time_start":"08:30","venue":{"name":"מרכז סוזן דלל","city":"תל אביב"}}');
insert into r select 'sd2', ingest('manual', null, null, null,
  '{"title":"גאגא/אנשים","date_start":"2026-10-04","weekdays":[0,2,4],"time_start":"19:00","venue":{"name":"מרכז סוזן דלל","city":"תל אביב"}}');
select pg_temp.eq((select res->>'outcome' from r where name='sd2'), 'created', 'second slot is its own event');
select pg_temp.eq((select jsonb_array_length(res->'candidates') from r where name='sd2'), 0, 'no question for different hours');
-- C3: a weekly rule without an end gets a 3-month horizon and is marked open-ended
select pg_temp.eq((select open_ended and date_end >= current_date + 89
                   from events where id = (select (res->>'event_id')::bigint from r where name='sd1')), true, 'C3 horizon');

-- ---- auto-publishing source, but it looks like a dupe → stays a draft
insert into r select 'tr1', ingest('tribe:gagapeople', 'g-1', null, null,
  '{"title":"Gaga people class","date_start":"2026-10-06","time_start":"19:00","venue":{"name":"מרכז סוזן דלל"}}');
select pg_temp.eq((select status::text from events where id = (select (res->>'event_id')::bigint from r where name='tr1')),
                  'draft', 'auto source + possible dupe → draft');
insert into r select 'tr2', ingest('tribe:gagapeople', 'g-2', null, null,
  '{"title":"GagaEden","date_start":"2026-10-07","time_start":"10:00","venue":{"name":"Eden studio","city":"תל אביב"}}');
select pg_temp.eq((select status::text from events where id = (select (res->>'event_id')::bigint from r where name='tr2')),
                  'live', 'auto source, nothing similar → live');

-- ---- venue kinds
insert into r select 'zoom', ingest('newsletter', 'nl-z', null, null,
  '{"title":"שיעור פתוח בזום – מפגש ראשון","date_start":"2026-09-04","venue":{"city":"אונליין"}}');
select pg_temp.eq((select v.kind::text from events e join venues v on v.id = e.venue_id
                   where e.id = (select (res->>'event_id')::bigint from r where name='zoom')), 'online', 'online venue');
insert into r select 'paros', ingest('newsletter', 'nl-p', null, null,
  '{"title":"Paros retreat","date_start":"2026-09-14","venue":{"name":"Paros","region":"חו״ל","country":"Greece"}}');
select pg_temp.eq((select v.kind::text from events e join venues v on v.id = e.venue_id
                   where e.id = (select (res->>'event_id')::bigint from r where name='paros')), 'abroad', 'abroad venue');

-- ---- invalid input is kept (E4) but makes no event
insert into r select 'bad', ingest('newsletter', 'nl-x', 'פרטים בקרוב', null, '{"title":"משהו"}');
select pg_temp.eq((select res->>'outcome' from r where name='bad'), 'invalid', 'no date → invalid');
select pg_temp.eq((select raw_text from source_records where external_id = 'nl-x'), 'פרטים בקרוב', 'raw kept');

-- ---- malformed values are dropped, not fatal
insert into r select 'messy', ingest('newsletter', 'nl-m', null, null,
  '{"title":"Messy","date_start":"2026-10-20","weekdays":["Tue",2],"price_min":"120₪","price_max":"80",
    "audience":["women_only","kids"],"venue":{"name":"X","kind":"castle"},"skip_dates":["soon"]}');
select pg_temp.eq((select res->>'outcome' from r where name='messy'), 'created', 'messy input still ingested');
select pg_temp.eq((select audience from events where id = (select (res->>'event_id')::bigint from r where name='messy')),
                  array['women_only'], 'unknown audience dropped (kids-only is out of scope)');
\echo ok
