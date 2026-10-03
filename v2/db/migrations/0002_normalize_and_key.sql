-- zuzu v2 — normalization + the canonical key (F1).
-- This is the ONE implementation. The API, the bot and the import all call these
-- functions in the database; nothing re-implements them in JS.

-- Lowercase, strip Latin accents and Hebrew nikud, drop quotes/geresh (ג'אם = ג׳אם = גאם),
-- turn every other non-letter (punctuation, emoji, dashes) into a space, collapse spaces.
create function norm_text(s text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(normalize(lower(coalesce(s, '')), NFKD),
                 '[̀-֑ͯ-ׇֽֿׁׂׅׄ]', '', 'g'),
               '[''"`׳״‘’“”]', '', 'g'),
             '[^a-z0-9א-תؠ-ي]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- Title for the key: norm_text minus filler words that sources add or drop
-- ("שיעור קונטקט עם נדב" = "קונטקט נדב"). The list is deliberately short:
-- every word added here makes two different titles more likely to collide.
create function norm_title(s text) returns text
language sql immutable parallel safe as $$
  select coalesce(string_agg(w, ' ' order by i), '')
  from unnest(string_to_array(norm_text(s), ' ')) with ordinality as t(w, i)
  where w <> '' and w not in ('שיעור', 'עם', 'ב', 'the', 'with')
$$;

-- D6: every time that has ever reached the sheet → a real time, or null.
-- Handles 8:30, 08:30, 1800, 830, :8:30, 8.30, 19:15-21:00, 20:00:00,
-- sheet day-fractions (0.875 = 21:00) and the "12/30/1899 08:30:00" epoch bug.
create function parse_time(s text) returns time
language plpgsql immutable parallel safe as $$
declare
  v text := btrim(coalesce(s, ''));
  m text[];
  h int;
  mi int;
  f numeric;
begin
  if v = '' then return null; end if;

  -- sheet serial fraction of a day
  if v ~ '^0?\.\d+$' then
    f := v::numeric;
    mi := round(f * 1440)::int;
    if mi >= 1440 then return null; end if;
    return make_time(mi / 60, mi % 60, 0);
  end if;

  -- "12/30/1899 08:30:00" → keep the time part
  v := regexp_replace(v, '^\d{1,2}/\d{1,2}/1899\s*', '');
  v := regexp_replace(v, '^:', '');

  m := regexp_match(v, '^(\d{1,2})[:.](\d{2})');            -- 8:30 / 08:30 / 8.30 / 19:15-21:00
  if m is null then
    m := regexp_match(v, '^(\d{1,2})(\d{2})$');             -- 1800 / 830
  end if;
  if m is null then
    m := regexp_match(v, '^(\d{1,2})$');                    -- "19"
    if m is not null then m := array[m[1], '00']; end if;
  end if;
  if m is null then return null; end if;

  h := m[1]::int;
  mi := m[2]::int;
  if h > 23 or mi > 59 then return null; end if;
  return make_time(h, mi, 0);
end $$;

-- D8: phone → 05X-XXXXXXX (mobile) or 0X-XXXXXXX (landline), else null.
-- 501234567 (sheet dropped the leading 0) and +972 forms are recovered.
create function norm_phone(s text) returns text
language plpgsql immutable parallel safe as $$
declare d text := regexp_replace(coalesce(s, ''), '\D', '', 'g');
begin
  if d like '972%' then d := '0' || substr(d, 4); end if;
  if length(d) = 9 and d ~ '^5' then d := '0' || d; end if;      -- lost leading zero
  if length(d) = 10 and d ~ '^05' then return substr(d, 1, 3) || '-' || substr(d, 4); end if;
  if length(d) = 9 and d ~ '^0[2-9]' then return substr(d, 1, 2) || '-' || substr(d, 3); end if;
  return null;
end $$;

-- D8: link must be a real URL. '#', '↗ פתח' and blanks → null. Bare domains get https://.
create function norm_link(s text) returns text
language plpgsql immutable parallel safe as $$
declare v text := btrim(coalesce(s, ''));
begin
  if v !~* '^https?://' and v ~* '^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(/\S*)?$' then
    v := 'https://' || v;
  end if;
  if v ~* '^https?://[^[:space:]]+\.[^[:space:]]+$' then return v; end if;
  return null;
end $$;

-- F1: the canonical key. Exact match on this = the same event, merged without asking.
--   date_start + normalized title + venue (directory id) + start time (if known)
-- Never host, never discipline. Time is included so that two different classes with the same
-- name at the same venue on the same day (Suzanne Dellal: Gaga 08:30 and Gaga 19:00) stay apart.
-- Near-misses (reworded title, missing time, different venue spelling) are caught by
-- find_duplicate_candidates() in 0003, not by this key.
create function canonical_key(d date, title text, venue_id bigint, t time) returns text
language sql immutable parallel safe as $$
  select d::text || '|' || norm_title(title) || '|' || coalesce(venue_id::text, '')
         || '|' || coalesce(to_char(t, 'HH24:MI'), '')
$$;

-- Keep events tidy on every write: key, C3 horizon, sorted de-duplicated sets.
create function events_before_write() returns trigger language plpgsql as $$
begin
  if new.weekdays = '{}' then new.weekdays := null; end if;
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
  new.canonical_key := canonical_key(new.date_start, new.title, new.venue_id, new.time_start);
  return new;
end $$;

create trigger events_before_write before insert or update on events
  for each row execute function events_before_write();
