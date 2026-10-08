-- English names for the /en site (approved by Dana 8.10).
-- Adds label_en / name_en next to the Hebrew names. Safe to re-run.
begin;
alter table public.disciplines add column if not exists label_en text;
alter table public.families    add column if not exists label_en text;
alter table public.formats     add column if not exists label_en text;
alter table public.regions     add column if not exists name_en  text;

update public.disciplines d set label_en = v.en from (values
 ('acro','Acro'),('african','African'),('authentic_movement','Authentic Movement'),('axis_syllabus','Axis Syllabus'),
 ('ballroom','Ballroom'),('belly_dance','Belly Dance'),('biodanza','Biodanza'),('bmc','Body-Mind Centering (BMC)'),
 ('classical','Classical (ballet)'),('conscious_movement','Conscious Movement'),('contact','Contact Improvisation'),
 ('contemporary','Contemporary'),('dance','Dance'),('ecstatic','Ecstatic Dance'),('five_rhythms','5Rhythms'),
 ('free_dance','Free Dance'),('gaga','Gaga'),('heart_rhythms','Heart Rhythms'),('hip_hop','Hip Hop'),
 ('improv','Improvisation'),('jazz','Jazz'),('laban','Laban'),('lifedance','LifeDance'),('lyrical','Lyrical'),
 ('martial_movement','Martial Arts & Movement'),('meditation','Movement Meditation'),('mindful_dance','Mindful Dance'),
 ('modern','Modern'),('movement_culture','Movement Culture'),('movement_research','Movement Research'),('nia','Nia'),
 ('playfight','Playfight'),('salsa_latin','Salsa & Latin'),('tribal_fusion','Tribal Fusion'),('voice','Voice'),('zumba','Zumba')
) v(slug, en) where d.slug = v.slug;

update public.families f set label_en = v.en from (values
 ('bodymind','Body & Mind'),('contact','Contact & Improvisation'),('dance','Dance'),('free','Free Dance'),
 ('guided','Guided Dance'),('movement','Movement, Acro & Martial Arts'),('research','Movement Research'),('world','World Dance')
) v(slug, en) where f.slug = v.slug;

update public.formats f set label_en = v.en from (values
 ('circle','Circle'),('class','Class'),('course','Course'),('event','Event'),('jam','Jam'),('party','Party'),
 ('performance','Performance'),('program','Program'),('retreat','Retreat'),('workshop','Workshop')
) v(slug, en) where f.slug = v.slug;

update public.regions r set name_en = v.en from (values
 ('abroad','Abroad'),('center','Central Israel'),('haifa-carmel','Haifa & Carmel Coast'),('jerusalem','Jerusalem Area'),
 ('north','North'),('online','Online'),('pardes-hana','Pardes Hanna Area'),('sharon','Sharon'),
 ('shfela-south','Shfela & South'),('tel-aviv','Tel Aviv Area')
) v(slug, en) where r.slug = v.slug;
commit;

-- Check: every row should have an English name (expect 0 missing in each).
select 'disciplines' t, count(*) filter (where label_en is null) missing, count(*) total from public.disciplines
union all select 'families', count(*) filter (where label_en is null), count(*) from public.families
union all select 'formats',  count(*) filter (where label_en is null), count(*) from public.formats
union all select 'regions',  count(*) filter (where name_en  is null), count(*) from public.regions;
