// Hand-written extraction outputs in the exact schema of bot/extract.js — what Claude is expected to
// return for tena-message.txt / ecstatic-listing.txt. They test mapping, not the model.
// (The live test in extract.live.test.js checks the model against the same expectations.)

const base = {
  language: "he", description: null, disciplines: [], formats: [], audience: [],
  venue_name: "סטודיו תנע", city: "עין שמר", location_on_registration: false, hosts: [],
  schedule: { kind: "once", date_start: null, date_end: null, weekdays: [], interval_weeks: null, sessions_count: null, valid_until: null, time_start: null, time_end: null, skip_dates: [] },
  price: { raw: null, kind: null, min: null, max: null, unit: null },
  link: "www.tena-studio.co.il/autumn", phones: ["052-555-1234", "04-6371234"],
  parent_index: null, notes: null, source_quote: "",
};
const ev = (o) => ({ ...base, ...o, schedule: { ...base.schedule, ...(o.schedule || {}) }, price: { ...base.price, ...(o.price || {}) } });

export const tenaExtraction = {
  message_notes: null,
  events: [
    ev({ // 0
      title: "PLAY-FIGHT – סדנת מבוא", disciplines: ["play_fight"], formats: ["workshop"], audience: ["beginners_welcome"],
      hosts: [{ name: "נועם ברק", kind: "person" }],
      schedule: { kind: "once", date_start: "2026-10-16", time_start: "10:00", time_end: "13:00" },
      price: { raw: "120 ₪", kind: "fixed", min: 120, max: 120, unit: "session" },
    }),
    ev({ // 1
      title: "PLAY-FIGHT – קורס", disciplines: ["play_fight"], formats: ["course"],
      hosts: [{ name: "נועם ברק", kind: "person" }],
      schedule: { kind: "weekly", date_start: "2026-10-19", weekdays: [1], interval_weeks: 1, sessions_count: 8, time_start: "20:00", time_end: "21:30", skip_dates: ["2026-11-02"] },
      price: { raw: "850 ₪ / 800 ₪ בהרשמה מוקדמת עד 10.10", kind: "fixed", min: 800, max: 850, unit: "course" },
    }),
    ev({ // 2
      title: "סוף שבוע של תנועה ושקט", disciplines: ["contact", "movement_meditation"], formats: ["retreat"],
      hosts: [{ name: "מאיה גולן", kind: "person" }, { name: "דני שחר", kind: "person" }],
      schedule: { kind: "range", date_start: "2026-11-13", date_end: "2026-11-14" },
      price: { raw: "סוף שבוע מלא 650 ₪ | יום בודד 350 ₪", kind: "range", min: 350, max: 650, unit: "weekend" },
    }),
    ev({ // 3 — class inside the retreat, sold separately
      title: "שיעור פתיחה – קונטקט", disciplines: ["contact"], formats: ["class"],
      hosts: [{ name: "דני", kind: "person" }],
      schedule: { kind: "once", date_start: "2026-11-13", time_start: "16:00", time_end: "18:00" },
      price: { raw: "90 ₪", kind: "fixed", min: 90, max: 90, unit: "session" }, parent_index: 2,
    }),
    ev({ // 4 — already exists (weekly Thu jam)
      title: "ג'אם קונטקט אימפרוביזציה", disciplines: ["contact"], formats: ["jam"],
      schedule: { kind: "weekly", weekdays: [4], interval_weeks: 1, time_start: "20:30", time_end: "23:00" },
      price: { raw: "50 ₪", kind: "fixed", min: 50, max: 50, unit: "session" },
    }),
    ev({ // 5 — one class on three weekdays
      title: "גאגא בוקר", disciplines: ["gaga"], formats: ["class"],
      schedule: { kind: "weekly", weekdays: [0, 2, 4], interval_weeks: 1, time_start: "08:30", time_end: "09:30" },
      price: { raw: "כרטיסייה 10 כניסות 500 ₪ / שיעור בודד 60 ₪", kind: "fixed", min: 50, max: 60, unit: "session" },
    }),
    ev({ // 6 — 14 meetings from 2.11
      title: "קורס מובמנט מדיטציה", disciplines: ["movement_meditation"], formats: ["course"],
      hosts: [{ name: "רותם לוי", kind: "person" }],
      schedule: { kind: "weekly", date_start: "2026-11-02", weekdays: [1], interval_weeks: 1, sessions_count: 14, time_start: "18:00", time_end: "19:30" },
      price: { raw: "1,400 ₪", kind: "fixed", min: 1400, max: 1400, unit: "course" },
    }),
  ],
};

export const ecstaticExtraction = {
  message_notes: null,
  events: [{
    ...ev({}),
    title: "Ecstatic Dance Tel Aviv ~ Full Moon Journey", language: "en",
    disciplines: ["ecstatic"], formats: ["party"],
    venue_name: "The Loft, Florentin", city: "Tel Aviv",
    hosts: [{ name: "Liran", kind: "person" }, { name: "Shir", kind: "person" }],
    schedule: { ...base.schedule, kind: "once", date_start: "2026-10-24", time_start: "11:00", time_end: "14:00" },
    price: { raw: "90 NIS early bird / 110 NIS at the door", kind: "range", min: 90, max: 110, unit: "session" },
    link: "https://ecstaticdance.org/event/tel-aviv-full-moon-2026-10-24", phones: [],
  }],
};
