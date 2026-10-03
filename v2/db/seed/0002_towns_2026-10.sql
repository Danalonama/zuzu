-- Towns that reached the v1 sheet without a region, mapped as approved on 3.10.2026.
-- Judgment calls (approved): בית חשמונאי / כפר האורנים follow מודיעין (ירושלים);
-- גבעת חיים איחוד / עין עירון / קציר-חריש follow חדרה (פרדס חנה והסביבה).
insert into cities (name, region_code) values
  ('מזכרת בתיה',      'center'),
  ('בית חנן',         'center'),
  ('כפר שמריהו',      'sharon'),
  ('גבעת חן',         'sharon'),
  ('בית השיטה',       'north'),
  ('געתון',           'north'),
  ('קריית ענבים',     'jerusalem'),
  ('כפר אוריה',       'jerusalem'),
  ('בית חשמונאי',     'jerusalem'),
  ('כפר האורנים',     'jerusalem'),
  ('גבעת חיים איחוד', 'pardes_hana'),
  ('עין עירון',       'pardes_hana'),
  ('קציר-חריש',       'pardes_hana'),
  ('Kazir Harish',    'pardes_hana')
on conflict (name) do update set region_code = coalesce(cities.region_code, excluded.region_code);
