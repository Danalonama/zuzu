// A small fake Supabase world for offline tests. Names mirror the real duplicate cases.
export const TODAY = "2026-09-30";

export const lookups = {
  disciplines: [
    { slug: "contact", label_he: "קונטקט אימפרוביזציה" },
    { slug: "gaga", label_he: "גאגא" },
    { slug: "ecstatic", label_he: "אקסטטיק דאנס" },
    { slug: "movement_meditation", label_he: "מדיטציה בתנועה" },
    { slug: "play_fight", label_he: "פליי פייט" },
    { slug: "authentic_movement", label_he: "תנועה אותנטית" },
  ],
  formats: ["circle", "class", "course", "event", "jam", "party", "performance", "program", "retreat", "workshop"],
  audience: ["women_only", "men_only", "beginners_welcome", "parents_with_kids", "sixty_plus", "partner_needed"],
  priceKinds: ["fixed", "range", "free", "donation"],
  priceUnits: ["session", "course", "day", "weekend", "punch_card"],
  hostKinds: ["person", "org"],
  venueKinds: ["studio", "outdoor", "online"],
};
lookups.discLabel = Object.fromEntries(lookups.disciplines.map((d) => [d.slug, d.label_he]));
lookups.fmtLabel = { class: "שיעור", course: "קורס", jam: "ג'אם", workshop: "סדנה", retreat: "ריטריט", party: "מסיבה", event: "אירוע" };

export const cities = [
  { id: 1, name: "עין שמר", aliases: [] },
  { id: 2, name: "תל אביב-יפו", aliases: ["תל אביב", "תא", "Tel Aviv"] },
  { id: 3, name: "הרצליה", aliases: ["Herzliya"] },
  { id: 4, name: "פרדס חנה-כרכור", aliases: ["פרדס חנה", "כרכור"] },
];

export const venues = [
  { id: "v-tena", name: "סטודיו תנע", aliases: ["תנע"], kind: "studio", city_id: 1, city: { id: 1, name: "עין שמר" } },
  { id: "v-boana", name: "בוא'נה", aliases: ["בואנה"], kind: "studio", city_id: 4, city: { id: 4, name: "פרדס חנה-כרכור" } },
  { id: "v-masl", name: "האחים מסלאוויטה 7", aliases: [], kind: "studio", city_id: 2, city: { id: 2, name: "תל אביב-יפו" } },
  { id: "v-teo", name: "מרכז תאו", aliases: ["TEO הרצליה", "TEO"], kind: "studio", city_id: 3, city: { id: 3, name: "הרצליה" } },
  { id: "v-loft", name: "The Loft", aliases: ["הלופט"], kind: "studio", city_id: 2, city: { id: 2, name: "תל אביב-יפו" } },
];

export const hosts = [
  { id: "h-noam", name: "נועם ברק", aliases: [], kind: "person" },
  { id: "h-maya", name: "מאיה גולן", aliases: ["Maya Golan"], kind: "person" },
  { id: "h-dani-s", name: "דני שחר", aliases: [], kind: "person" },
  { id: "h-dani-a", name: "דני אשכנזי", aliases: [], kind: "person" },
];

// Existing PLAY-FIGHT intro + course at Tena, with last season's dates → the bot should propose updates.
export const events = [
  {
    id: "e-pf-intro", title: "PLAY-FIGHT סדנת מבוא", language: "he", status: "live", venue_id: "v-tena",
    date_start: "2026-09-18", date_end: null, valid_until: null, rule_weekdays: null, rule_interval_weeks: null,
    time_start: "10:00:00", time_end: "13:00:00", disciplines: ["play_fight"], formats: ["workshop"], audience: [],
    price_raw: "100 ₪", price_kind: null, price_min: 100, price_max: 100, price_unit: null,
    link: null, phone: "052-5551234", description: null, location_on_registration: false,
  },
  {
    id: "e-jam", title: "ג'אם קונטקט", language: "he", status: "live", venue_id: "v-tena",
    date_start: "2026-01-08", date_end: null, valid_until: null, rule_weekdays: [4], rule_interval_weeks: 1,
    time_start: "20:30:00", time_end: "23:00:00", disciplines: ["contact"], formats: ["jam"], audience: [],
    price_raw: "50 ₪", price_kind: "fixed", price_min: 50, price_max: 50, price_unit: "session",
    link: null, phone: "052-5551234", description: null, location_on_registration: false,
  },
  {
    id: "e-other", title: "ערב אקסטטי", language: "he", status: "live", venue_id: "v-masl",
    date_start: "2026-10-24", date_end: null, valid_until: null, rule_weekdays: null, rule_interval_weeks: null,
    time_start: "21:00:00", time_end: null, disciplines: ["ecstatic"], formats: ["party"], audience: [],
    price_raw: null, price_kind: null, price_min: null, price_max: null, price_unit: null,
    link: "https://example.org/x", phone: null, description: null, location_on_registration: false,
  },
];

export const world = () => structuredClone({ venues, cities, hosts, events });
