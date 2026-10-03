-- Styles and formats: Hebrew words in, codes stored, labels out (0006).
\set QUIET on
create or replace function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;
truncate events, event_hosts, event_keys, source_records, duplicate_candidates restart identity cascade;

select pg_temp.eq(vocab_codes('discipline', array['קונטקט', 'חקר התנועה', 'חקר תנועה', 'Contact Improv']),
                  array['contact_improv', 'movement_research'], 'variants and English → one code each');
select pg_temp.eq(vocab_codes('format', array['מסיבה/ריקוד', 'הופעה', 'ג׳אם']),
                  array['party', 'performance', 'jam'], 'format variants (incl. geresh)');

-- an unknown word is kept as a pending entry, not dropped
select pg_temp.eq(vocab_codes('discipline', array['פלדנקרייז']), array['new_פלדנקרייז'], 'unknown → pending code');
select pg_temp.eq((select approved from vocab where code = 'new_פלדנקרייז'), false, 'pending, not approved');

-- ingest stores codes; the site gets Hebrew labels
select ingest('manual', null, null, null,
  '{"title":"ערב קונטקט","date_start":"2026-11-05","disciplines":"קונטקט, פלדנקרייז","formats":["ג''אם"]}');
update events set status = 'live';
select pg_temp.eq((select disciplines from events), array['contact_improv', 'new_פלדנקרייז'], 'codes stored');
select pg_temp.eq((select discipline_labels || format_labels from site_events('2026-11-05', '2026-11-05')),
                  array['קונטקט', 'פלדנקרייז', 'ג''אם'], 'labels for the site');

-- the bot folds the new word into an existing code; events follow
select vocab_merge('discipline', 'new_פלדנקרייז', 'movement');
select pg_temp.eq((select disciplines from events), array['contact_improv', 'movement'], 'merged into movement');
select pg_temp.eq(vocab_codes('discipline', array['פלדנקרייז']), array['movement'], 'and remembered');

-- a label can change without touching data
update vocab set label_he = 'קונטקט אימפרוביזציה' where kind = 'discipline' and code = 'contact_improv';
select pg_temp.eq((select discipline_labels[1] from site_events('2026-11-05', '2026-11-05')),
                  'קונטקט אימפרוביזציה', 'relabel');
\echo ok
