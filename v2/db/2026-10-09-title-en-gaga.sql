-- English titles for the /en site (approved by Dana 9.10).
-- Adds events.title_en; en.html shows it when it is set, otherwise the normal title.
-- First use: the regular (weekly) Gaga classes are called "Gaga" in English,
-- and the weekly intro classes "Gaga Welcome". One-off Gaga events keep their title.
-- The Hebrew site is not affected. Safe to re-run.
begin;
alter table public.events add column if not exists title_en text;

update public.events
   set title_en = case when title ilike 'Gaga Welcome%' then 'Gaga Welcome' else 'Gaga' end
 where 'gaga' = any(disciplines)
   and rule_weekdays is not null
   and cardinality(rule_weekdays) > 0;
commit;

-- Check: the weekly Gaga rows (10 on 9.10) with their new English title
select title, title_en, rule_weekdays from public.events
 where 'gaga' = any(disciplines) order by title_en nulls last, title;
