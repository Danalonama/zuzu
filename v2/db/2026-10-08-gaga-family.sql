-- Gaga belongs in חקר תנועה (research) only, not in קונטקט ואימפרוביזציה (contact).
-- Requested by Dana 8.10. Before this, gaga was linked to both families, so every
-- gaga class also showed under the contact & improv filter. Safe to re-run.
begin;
delete from public.discipline_families where discipline = 'gaga' and family = 'contact';
insert into public.discipline_families (discipline, family)
  select 'gaga', 'research'
  where not exists (select 1 from public.discipline_families where discipline = 'gaga' and family = 'research');
commit;

-- Check: should return one row, family = research
select * from public.discipline_families where discipline = 'gaga';
