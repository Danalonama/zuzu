-- Normalizers, against values that actually reached the v1 sheet.
\set QUIET on
create or replace function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;

-- D6: times
select pg_temp.eq(parse_time('8:30'), '08:30'::time, '8:30');
select pg_temp.eq(parse_time('1800'), '18:00'::time, '1800');
select pg_temp.eq(parse_time(':8:30'), '08:30'::time, ':8:30 (corrections tab)');
select pg_temp.eq(parse_time('0.875'), '21:00'::time, 'sheet day fraction');
select pg_temp.eq(parse_time('0.4583333333'), '11:00'::time, 'sheet day fraction 11:00');
select pg_temp.eq(parse_time('12/30/1899 08:30:00'), '08:30'::time, '1899 epoch bug');
select pg_temp.eq(parse_time('19:15-21:00'), '19:15'::time, 'range → start');
select pg_temp.eq(parse_time('25:00'), null::time, 'impossible hour');
select pg_temp.eq(parse_time('בקרוב'), null::time, 'free text');

-- D8: phones and links
select pg_temp.eq(norm_phone('526827887'), '052-6827887', 'sheet dropped leading 0');
select pg_temp.eq(norm_phone('+972 52 551 4430'), '052-5514430', '+972');
select pg_temp.eq(norm_phone('04-8123456'), '04-8123456', 'landline');
select pg_temp.eq(norm_phone('סטודיו'), null::text, 'not a phone (teachers tab)');
select pg_temp.eq(norm_link('#'), null::text, '# is not a link');
select pg_temp.eq(norm_link('↗ פתח'), null::text, 'sheet link label');
select pg_temp.eq(norm_link('www.studiotena.org/neto-contact'), 'https://www.studiotena.org/neto-contact', 'bare domain');

-- F1: titles
select pg_temp.eq(norm_title('קורס Play-Fight'), norm_title('קורס PLAY-FIGHT'), 'case + dash');
select pg_temp.eq(norm_title('ג''אם לייב'), norm_title('ג׳אם לייב'), 'apostrophe vs geresh');
select pg_temp.eq(norm_title('שיעור קונטקט עם נדב'), 'קונטקט נדב', 'filler words');
select pg_temp.eq(norm_title('בָּרוּךְ 🎉 Miss yūgen!!'), 'ברוך miss yugen', 'nikud, emoji, accents');
select pg_temp.eq(canonical_key('2026-09-01', 'Gaga', 7, '08:30') <> canonical_key('2026-09-01', 'Gaga', 7, '19:00'),
                  true, 'same class name, different hour = different key');
\echo ok
