/**
 * Zuzu — events backend (Google Apps Script)
 * ------------------------------------------------------------
 * One free endpoint on top of a Google Sheet:
 *   • POST {event fields}            → appended as a new row, approved = FALSE
 *   • POST {action:"scan", image}    → runs the screenshot through Claude vision
 *                                       and returns the events it found (JSON)
 *   • GET  ?action=approved          → every row whose "approved" box is ticked, as JSON
 *
 * You moderate by ticking the "approved" checkbox in the Sheet.
 * See SETUP.md for the install (Sheet + deploy + API key).
 *
 * ── DEDUP CHANGE (2026-08-10) ────────────────────────────────────────────────
 * _evKey now keys on date + TITLE + VENUE (was date + city + category).
 * Why: on the live store, the same event is often tagged under a different
 * category — so the old key SPLIT true duplicates apart AND, because _submitEvent
 * MERGES on a key match, it could silently absorb two genuinely different
 * same-day/same-city/same-category events into one row. Title+venue identifies the
 * real event, so the merge stays conservative and never eats a distinct event.
 */

var SHEET_NAME = 'events';
var COLS = ['timestamp','approved','date','time','time_end','title','host','category','venue','city','region','url','price','phone','date_end','type','repeat','dates','count','teachers'];  // +time_end +date_end +type +phone +repeat +dates +count +teachers (rotating-teacher weekly slots: "1.9=שם; 8.9=שם")
var ANALYTICS_SHEET = 'analytics';
var ANALYTICS_COLS = ['timestamp','event','value','extra1','extra2','page'];

// TAXONOMY — two separate axes (the site shows + filters each one on its own):
//   CATEGORIES = discipline (what movement style it is)
//   TYPES      = format     (what kind of event it is)
// Keep jam/workshop/etc OUT of CATEGORIES — they are formats, not disciplines.
var CATEGORIES = "קונטקט, אקסטטיק, גאגא, אימפרוביזציה, מחול, ביודנסה, מובמנט, ריקוד חופשי, חקר תנועה, ריקודי בטן, אקרו, מעגל נשים, ניה, אחר";
var TYPES = "ג'אם, סדנה, שיעור, מופע, מסיבה, קורס, ריטריט, מאסטר-קלאס, אינטנסיב, אירוע, נשים בלבד, גברים בלבד";

// AREA TAGGING — city (and a few recurring venues) -> region. Authoritative: overrides
// the AI's region guess when the place is known. Grow these two maps as venues repeat;
// unknown cities fall back to whatever the AI inferred.
var CITY_REGION = {
  'תל אביב':'תל אביב','תל אביב-יפו':'תל אביב','יפו':'תל אביב','רמת גן':'תל אביב','גבעתיים':'תל אביב','בת ים':'תל אביב','חולון':'תל אביב',
  'הוד השרון':'שרון','כפר סבא':'שרון','רעננה':'שרון','הרצליה':'שרון','רמת השרון':'שרון','כפר יונה':'שרון','צור יגאל':'שרון',
  'ירושלים':'ירושלים','בית שמש':'ירושלים','מבשרת ציון':'ירושלים',
  'חיפה':'צפון','טבריה':'צפון','כרמיאל':'צפון','צפת':'צפון','עכו':'צפון','נהריה':'צפון','טבעון':'צפון','יקנעם':'צפון',
  'באר שבע':'דרום','אשדוד':'דרום','אשקלון':'דרום','אילת':'דרום','שדרות':'דרום','מצפה רמון':'דרום','ערד':'דרום','עומר':'דרום',
  'פרדס חנה':'פרדס חנה והסביבה','כרכור':'פרדס חנה והסביבה','בנימינה':'פרדס חנה והסביבה','זכרון יעקב':'פרדס חנה והסביבה','קיסריה':'פרדס חנה והסביבה','גבעת עדה':'פרדס חנה והסביבה',
  'ראשון לציון':'מרכז','רחובות':'מרכז','נס ציונה':'מרכז','פתח תקווה':'מרכז','מודיעין':'מרכז','לוד':'מרכז','רמלה':'מרכז','נתניה':'מרכז','יבנה':'מרכז','אור יהודה':'מרכז','ראש העין':'מרכז',
  'אונליין':'אונליין','זום':'אונליין','online':'אונליין','zoom':'אונליין'
};
var VENUE_REGION = {          // venue-name substring -> region (used when city is missing/unknown)
  'סילו':'שרון',              // סילו תרבות, הוד השרון
  'ניו יורק 17':'תל אביב',    // קהילת ניו יורק 17
  'סטודיו טנה':'שרון',        // studiotena, כפר יונה
  'סוזן דלל':'תל אביב',       // מרכז סוזן דלל — always Tel Aviv
  'האחים מסלוויטה':'תל אביב'  // האחים מסלוויטה 7, ת"א (Deep Contact / מבוא)
};
var VENUE_CITY = {            // venue-name substring -> CITY (well-known fixed venues)
  'סוזן דלל':'תל אביב','סוזן דלאל':'תל אביב','סוזאן דלל':'תל אביב','suzanne dellal':'תל אביב'
};
function _regionForPlace(venue, city, fallback) {
  var v = String(venue || '').toLowerCase();
  for (var k in VENUE_REGION) { if (v.indexOf(k.toLowerCase()) >= 0) return VENUE_REGION[k]; }
  var c = String(city || '').trim();
  if (c) { for (var ck in CITY_REGION) { if (c.indexOf(ck) >= 0) return CITY_REGION[ck]; } }
  return fallback || '';
}
/** Known-venue -> city (fills a blank/unknown city for fixed venues like Suzanne Dellal). */
function _cityForVenue(venue) {
  var v = String(venue || '').toLowerCase();
  for (var k in VENUE_CITY) { if (v.indexOf(k.toLowerCase()) >= 0) return VENUE_CITY[k]; }
  return '';
}
/** One-shot: fill city from VENUE_CITY on rows whose venue is a known fixed place but city is blank/wrong. */
function retagVenueCity() {
  var sh = _sheet(), idx = _headerIdx(sh);
  if (idx.venue === undefined || idx.city === undefined) return 'missing venue/city';
  var data = sh.getDataRange().getValues(), fixed = 0;
  for (var r = 1; r < data.length; r++) {
    var vc = _cityForVenue(data[r][idx.venue]);
    if (vc && String(data[r][idx.city] || '').trim() !== vc) {
      data[r][idx.city] = vc;
      if (idx.region !== undefined) data[r][idx.region] = _regionForPlace(data[r][idx.venue], vc, data[r][idx.region]);
      fixed++;
    }
  }
  if (fixed) sh.getDataRange().setValues(data);
  Logger.log('retagVenueCity: fixed ' + fixed + ' row(s)');
  return 'retagVenueCity: fixed ' + fixed + ' row(s).';
}

/* ============================================================
 *  WEEKLY SLOTS WITH A ROTATING-TEACHER SCHEDULE
 *  A fixed weekly class (venue+day+time) that ALWAYS shows on Zuzu, where the
 *  teacher changes each week. The site shows the right teacher per date from a
 *  schedule string; weeks not yet listed show "המורה יתעדכן".
 *
 *  Monthly update: edit the schedule string in setupLanuaGaga()/setupTeoGaga()
 *  (or the row's `teachers` cell in the sheet) and re-run. Format:
 *      "1.9=יערה מוזס; 8.9=קורליה לך; 15.9=גילי תניה"
 *  Run from the editor; no redeploy needed to run, but redeploy so the site's
 *  doGet uses the per-date teacher logic.
 * ============================================================ */
function _upsertWeeklySlot(cfg) {
  var sh = _sheet();
  _ensureCol(sh, 'teachers'); _ensureCol(sh, 'repeat');
  var idx = _headerIdx(sh);
  var key = _evKey({ date: cfg.startDate, title: cfg.title, venue: cfg.venue });
  var existing = _rowIndexByKey(sh, key);
  if (existing > 0) {                                   // refresh the schedule; leave approve-state as-is
    if (idx.teachers !== undefined) sh.getRange(existing, idx.teachers + 1).setValue(cfg.teachers || '');
    if (idx.repeat !== undefined) sh.getRange(existing, idx.repeat + 1).setValue('weekly');
    if (idx.url !== undefined && cfg.url) sh.getRange(existing, idx.url + 1).setValue(cfg.url);
    if (idx.time !== undefined && cfg.time) sh.getRange(existing, idx.time + 1).setValue(cfg.time);
    return 'updated row ' + existing;
  }
  var res = _submitEvent({
    date: cfg.startDate, time: cfg.time, title: cfg.title, host: '',
    category: cfg.category || 'גאגא', type: cfg.type || 'שיעור', venue: cfg.venue, city: cfg.city || '',
    url: cfg.url || '', repeat: 'weekly', teachers: cfg.teachers || ''
  }, false, 'weekly-slot');                             // approved=FALSE → lands in the review queue
  return 'inserted for review (' + (res && res.status) + ')';
}

function setupLanuaGaga() {
  var url = 'https://www.gagapeople.com/gaga-pardes-hanna/';
  var venue = 'סטודיו לנוע, פרדס חנה', city = 'פרדס חנה כרכור', title = 'שיעור גאגא — סטודיו לנוע, פרדס חנה';
  var tue = '1.9=יערה מוזס; 8.9=קורליה לך; 15.9=גילי תניה; 22.9=איה ישראלי; 29.9=רני לבצלטר';
  var fri = '4.9=סטפן פרי; 18.9=עלמה קרבט שמש';
  var a = _upsertWeeklySlot({ startDate: '2026-09-01', time: '19:15', title: title, category: 'גאגא', venue: venue, city: city, url: url, teachers: tue });
  var b = _upsertWeeklySlot({ startDate: '2026-09-04', time: '11:00', title: title, category: 'גאגא', venue: venue, city: city, url: url, teachers: fri });
  Logger.log('Lanua Gaga — Tue 19:15: ' + a + ' | Fri 11:00: ' + b);
  return 'Lanua Gaga slots set (Tue 19:15 + Fri 11:00).';
}

function setupTeoGaga() {
  var url = 'https://teo.org.il/dance/גאגא-אנשים-הרצליה/';
  var venue = 'TEO הרצליה', city = 'הרצליה', title = 'שיעור גאגא — TEO הרצליה';
  var a = _upsertWeeklySlot({ startDate: '2026-09-01', time: '19:00', title: title, category: 'גאגא', venue: venue, city: city, url: url, teachers: '' });
  var b = _upsertWeeklySlot({ startDate: '2026-09-04', time: '10:30', title: title, category: 'גאגא', venue: venue, city: city, url: url, teachers: '' });
  Logger.log('TEO Gaga — Tue 19:00: ' + a + ' | Fri 10:30: ' + b + ' (teachers blank — fill when advertised)');
  return 'TEO Gaga slots set (Tue 19:00 + Fri 10:30). Add teachers when advertised.';
}

/* One-shot: the Pardes Hana studio is לנוע (not לנואה). Fix the spelling in
 * every title/venue cell already on the site. Run once; safe to re-run. */
function fixLanuaName() {
  var sh = _sheet(), col = _headerIdx(sh);
  var last = sh.getLastRow(); if (last < 2) return 'empty';
  var rng = sh.getRange(2, 1, last - 1, sh.getLastColumn()), vals = rng.getValues(), n = 0;
  var cols = ['title', 'venue'].filter(function (c) { return col[c] !== undefined; });
  for (var i = 0; i < vals.length; i++) {
    cols.forEach(function (c) {
      var v = String(vals[i][col[c]] || '');
      if (v.indexOf('לנואה') >= 0) { vals[i][col[c]] = v.split('לנואה').join('לנוע'); n++; }
    });
  }
  if (n) rng.setValues(vals);
  Logger.log('fixLanuaName: fixed ' + n + ' cell(s) לנואה→לנוע');
  return 'fixLanuaName: fixed ' + n + ' cell(s) לנואה→לנוע';
}

/* One-shot: the לנוע studio (Pardes Hana) is a GAGA studio. Old rows there
 * were mis-tagged (e.g. מובמנט) and mis-titled (שיעור תנועה). Force any row at
 * that studio to category=גאגא and a proper Gaga title, and fix venue spelling.
 * Matches by venue/title mentioning לנוע/לנואה, or a Pardes-Hana movement row
 * (city פרדס חנה + title/category that isn't already clearly something else).
 * ⚠ If there's a genuine NON-Gaga class in Pardes Hana, tell me to narrow this.
 * Safe to re-run. */
function fixLanuaGaga() {
  var sh = _sheet(), col = _headerIdx(sh);
  if (col.title === undefined || col.category === undefined) return 'no title/category column';
  var last = sh.getLastRow(); if (last < 2) return 'empty';
  var rng = sh.getRange(2, 1, last - 1, sh.getLastColumn()), vals = rng.getValues(), n = 0;
  for (var i = 0; i < vals.length; i++) {
    var ven = col.venue !== undefined ? String(vals[i][col.venue] || '') : '';
    var ttl = String(vals[i][col.title] || '');
    var cat = String(vals[i][col.category] || '');
    var city = col.city !== undefined ? String(vals[i][col.city] || '') : '';
    var atLanua = /לנוע|לנואה/.test(ven + ' ' + ttl);
    var pardesMovement = /פרדס\s*חנה/.test(city) && (/תנועה|גאגא/.test(ttl) || cat.indexOf('מובמנט') >= 0 || cat.indexOf('גאגא') >= 0);
    if (!atLanua && !pardesMovement) continue;
    if (col.venue !== undefined) {
      var nv = ven.split('לנואה').join('לנוע');
      vals[i][col.venue] = /לנוע/.test(nv) ? nv : 'סטודיו לנוע, פרדס חנה';
    }
    vals[i][col.category] = 'גאגא';
    vals[i][col.title] = 'שיעור גאגא — סטודיו לנוע, פרדס חנה';
    n++;
  }
  if (n) rng.setValues(vals);
  Logger.log('fixLanuaGaga: fixed ' + n + ' Lanua row(s) → גאגא');
  return 'fixLanuaGaga: fixed ' + n + ' Lanua row(s) → category גאגא + title שיעור גאגא';
}

/* One-shot: any row tagged גאגא whose TITLE isn't a Gaga title (e.g. old
 * "שיעור תנועה" rows) → retitle to "שיעור גאגא — <venue>". A Gaga class must
 * read גאגא / שיעור גאגא, never שיעור תנועה. Safe to re-run. */
function retitleGagaClasses() {
  var sh = _sheet(), col = _headerIdx(sh);
  if (col.category === undefined || col.title === undefined) return 'no category/title column';
  var last = sh.getLastRow(); if (last < 2) return 'empty';
  var rng = sh.getRange(2, 1, last - 1, sh.getLastColumn()), vals = rng.getValues(), n = 0;
  for (var i = 0; i < vals.length; i++) {
    var cat = String(vals[i][col.category] || '');
    var ttl = String(vals[i][col.title] || '');
    if (cat.indexOf('גאגא') < 0) continue;             // only Gaga rows
    if (ttl.indexOf('גאגא') >= 0) continue;            // already a Gaga title — leave it
    var ven = col.venue !== undefined ? String(vals[i][col.venue] || '').trim() : '';
    vals[i][col.title] = ven ? 'שיעור גאגא — ' + ven : 'שיעור גאגא';
    n++;
  }
  if (n) rng.setValues(vals);
  Logger.log('retitleGagaClasses: retitled ' + n + ' Gaga row(s)');
  return 'retitleGagaClasses: retitled ' + n + ' Gaga row(s) to "שיעור גאגא"';
}

/* ============================================================
 *  IRIS NICE — הגוף בטבע / Body In Nature (אזור השרון)
 *  Two offerings, both discipline חקר תנועה (somatic/movement exploration),
 *  contact = Iris's phone (no registration link). Publishes LIVE.
 *  A) בוקר אור — single special morning by the sea, ערב ראש השנה 11.9.
 *  B) סדרת הסתיו — an 8-session Tuesday-morning course (repeat=dates);
 *     the first meeting (8.9) is the open / trial class.
 *  ⚠ City tentative (שפיים / אזור השרון) — confirm with Iris and fix the
 *    CITY var if wrong; exact beach point goes to registrants anyway.
 * ============================================================ */
function setupIrisNiceEvents() {
  var HOST = 'איריס נייס', PHONE = '053-447-6385';
  var CITY = 'שפיים', REGION = 'שרון';   // ⚠ tentative — confirm the exact town
  // A) בוקר אור — single event
  var a = _submitEvent({
    date: '2026-09-11', time: '09:00', time_end: '13:30',
    title: 'בוקר אור — שער לשנה חדשה | מפגש בוקר מיוחד',
    host: HOST, category: 'חקר תנועה', type: 'סדנה',
    venue: 'חוף הים, אזור השרון (נקודת המפגש תישלח לנרשמים)',
    city: CITY, region: REGION, phone: PHONE
  }, true, 'iris-nice');
  // B) סדרת הסתיו — 8-session course, first meeting (8.9) is the open/trial class
  var b = _submitEvent({
    date: '2026-09-08', time: '09:30', time_end: '14:00',
    title: 'סדרת הסתיו — הגוף בטבע · איריס נייס (המפגש הראשון, 8.9, פתוח לניסיון)',
    host: HOST, category: 'חקר תנועה', type: 'קורס',
    venue: 'בטבע, אזור השרון',
    city: CITY, region: REGION, phone: PHONE,
    repeat: 'dates',
    dates: '2026-09-08, 2026-09-15, 2026-10-20, 2026-10-27, 2026-11-03, 2026-11-10, 2026-11-17, 2026-11-24'
  }, true, 'iris-nice');
  Logger.log('setupIrisNiceEvents: בוקר אור=' + (a && a.status) + ' | סדרת הסתיו=' + (b && b.status));
  return 'Iris Nice: בוקר אור (11.9) + סדרת הסתיו (8 מפגשים) published live.';
}
/* גוהר — פעימה שבועית בתנועה נשית שורשית (Pardes Hana). Weekly women's movement
 * class rooted in belly dance / ethnic / authentic movement. Intro meeting Wed
 * 14.10 10:30, then weekly. Publishes LIVE. ⚠ Category tagged ריקודי בטן (the
 * concrete discipline + her bellydance domain) — could also be מעגל נשים / מחול. */
function setupGoharClass() {
  _deleteBySource('gohar');   // replace on re-run so tags/fields actually update
  var r = _submitEvent({
    date: '2026-10-14', time: '10:30',
    title: 'פעימה שבועית בתנועה נשית שורשית',
    host: 'גוהר', category: 'מחול, ריקודי בטן', type: 'שיעור, נשים בלבד',
    venue: '', city: 'פרדס חנה כרכור', region: 'פרדס חנה והסביבה',
    phone: '0526006393', url: 'https://www.gohar-bellydance.com/classes',
    repeat: 'weekly'
  }, true, 'gohar');
  Logger.log('setupGoharClass: ' + (r && r.status));
  return 'setupGoharClass: פעימה שבועית (גוהר, פרדס חנה) published live — מחול/ריקודי בטן · שיעור/נשים בלבד.';
}

/* מיכל חלפן — "מקצבי הלב רוקדים" · ריקוד חופשי בהנחיה. Publishes LIVE.
 *  - Weekly: every Thursday 20:30 at עדנים (Sharon).
 *  - September one-offs at rotating venues (can't be one recurring row):
 *    מוצ"ש 20:00 — 5.9 שדות ים · 12.9 זן גארדן · 19.9 זן גארדן · 26.9 שדות ים
 *    שבת  11:00 — 12.9 מרכז קשת רעננה · 26.9 מרכז קשת רעננה
 *  Re-run monthly with the new dates (delete old first via removeMakatzveiHalev). */
function setupMakatzveiHalev() {
  var HOST = 'מיכל חלפן', PHONE = '054-7523399', PRICE = '80₪ · 70₪ בכרטיסיה',
      T = 'מקצבי הלב רוקדים — ריקוד חופשי בהנחיית מיכל חלפן', CAT = 'ריקוד חופשי', TY = 'שיעור';
  var n = 0;
  _submitEvent({ date: _nextWeekdayIso(4), time: '20:30', title: T, host: HOST, category: CAT, type: TY,
    venue: 'עדנים', region: 'שרון', phone: PHONE, price: PRICE, repeat: 'weekly' }, true, 'michal-halfen'); n++;
  var evs = [
    ['2026-09-05','20:00','שדות ים','שדות ים','פרדס חנה והסביבה'],
    ['2026-09-12','20:00','זן גארדן','פרדס חנה כרכור','פרדס חנה והסביבה'],
    ['2026-09-19','20:00','זן גארדן','פרדס חנה כרכור','פרדס חנה והסביבה'],
    ['2026-09-26','20:00','שדות ים','שדות ים','פרדס חנה והסביבה'],
    ['2026-09-12','11:00','מרכז קשת','רעננה','שרון'],
    ['2026-09-26','11:00','מרכז קשת','רעננה','שרון']
  ];
  evs.forEach(function (s) {
    _submitEvent({ date: s[0], time: s[1], title: T, host: HOST, category: CAT, type: TY,
      venue: s[2], city: s[3], region: s[4], phone: PHONE, price: PRICE }, true, 'michal-halfen'); n++;
  });
  Logger.log('setupMakatzveiHalev: ' + n);
  return 'setupMakatzveiHalev: ' + n + ' events (weekly Thu + 6 dated Sept sessions) published live.';
}
function removeMakatzveiHalev() { var n = _deleteBySource('michal-halfen'); return 'removed ' + n + ' michal-halfen row(s)'; }

/* Undo the hand-added Iris rows — the series already arrives from a feed, so my
 * copies are duplicates. Removes BOTH iris-nice rows (series + בוקר אור); if
 * בוקר אור (11.9) isn't on the site from the feed, tell me and I'll re-add just it. */
function removeIrisNiceEvents() {
  var n = _deleteBySource('iris-nice');
  Logger.log('removeIrisNiceEvents: removed ' + n);
  return 'removeIrisNiceEvents: removed ' + n + ' hand-added Iris row(s)';
}

// DISCIPLINE (category) RULES — keyword → discipline, checked in order, first match wins.
// Authoritative: overrides the AI's category guess when a known keyword is present.
// KEY DECISION (Dana): מובמנט is reserved for Ido-Portal-lineage movement practice ONLY
// (Flow Motion, Movement Freaks / Stas, Movement Culture, Yaron Palchik, Ido Portal) —
// NOT a catch-all. Everything else routes to its real discipline. Grow these as needed.
// Ordered most-specific first (e.g. contact before generic improv). No match => keep the AI guess.
var DISCIPLINE_RULES = [
  [/ido\s*portal|אידו\s*פורטל|flow\s*motion|פלואו\s?מושן|פלואומושן|movement\s*freaks|מובמנט\s*פריקס|movement\s*culture|ירון\s*פלצ['׳]?יק|yaron\s*palchik|\bstas\b/i, 'מובמנט'],
  [/קונטקט|contact\s*improv|contact\s*jam|deep\s*contact|אימפרוביזצי[הת]?\s*מגע/i, 'קונטקט'],
  [/אקסטטי|ecstatic/i, 'אקסטטיק'],
  [/גאגא|gaga/i, 'גאגא'],
  [/ביודנסה|biodanza/i, 'ביודנסה'],
  [/(?:^|[\s,.\-–])ניה(?=[\s,.\-–]|$)|\bnia\b/i, 'ניה'],
  [/אקרו|acroyoga|acro\s*yoga/i, 'אקרו'],
  [/ריקודי?\s*בטן|belly\s*dance|\braqs\b/i, 'ריקודי בטן'],
  [/מעגל\s*נש(?:ים|י)|women'?s?\s*circle/i, 'מעגל נשים'],
  [/ריקוד\s*חופשי|free\s*dance|open\s*floor|5\s*rhythms|חמשת\s*המקצבים|movement\s*medicine|dancing\s*freedom|ריו\s*אביירטו|r[íi]o\s*abierto/i, 'ריקוד חופשי'],
  [/חקר\s*תנועה|authentic\s*movement|תנועה\s*אותנטית/i, 'חקר תנועה'],
  [/תנועה\s*מודעת|conscious\s*movement|mindful\s*movement/i, 'חקר תנועה, מחול'],  // e.g. Vertigo / עימי
  [/מחול|\bballet\b|modern\s*dance|רפרטואר/i, 'מחול'],
  [/אימפרוביזצי|improvis/i, 'אימפרוביזציה']
];
function _disciplineFor(title, host, venue, fallback) {
  var hay = [title, host, venue].filter(Boolean).join(' ');
  for (var i = 0; i < DISCIPLINE_RULES.length; i++) { if (DISCIPLINE_RULES[i][0].test(hay)) return DISCIPLINE_RULES[i][1]; }
  // מובמנט is reserved for the Ido-Portal rule ABOVE only. Never accept it as an AI/source
  // guess — a non-Ido "מובמנט" guess is demoted to 'אחר' so it goes to review, not the site.
  if (String(fallback || '').trim() === 'מובמנט') return 'אחר';
  return fallback || '';
}

// SOURCE PROFILES — known recurring sources whose events arrive with an empty or
// "#" url and/or no phone (host is inconsistent, so the teacher directory misses
// them). Text-match on title/host/venue -> canonical url + phone. Fills only blanks.
// Grow this as fixes repeat.
var SOURCE_LINKS = [
  { match: /movement\s*freaks|מובמנט\s*פריקס|\bstas\b|סטס|קזנוביץ/i,
    url: 'https://movementfreaks.com/', phone: '+972 52-445-4907' },   // Stas Kazanovitz
  { // Deep Contact (owned by Saar & Sasha) + its teachers, HE/EN spellings.
    // No default url on purpose — each Deep Contact course/workshop has its own
    // page, so leave url to the specific link captured in review. Phone defaults
    // unless the listing carries its own.
    match: /deep\s*contact|mavo|\bsaar\b|\bsasha\b|סער|סשה|רות\s*אהרוני|rut?h?\s*aharoni|עתר\s*שילה|atar\s*shilo|רותם\s*רם|rotem\s*ram|רן\s*בן\s*דרור|ran\s*ben\s*dror|מנדי\s*מיכאלי|mandy\s*michaeli/i,
    phone: '0503010073' }
];
function _sourceProfile(title, host, venue) {
  var hay = [title, host, venue].filter(Boolean).join(' ');
  for (var i = 0; i < SOURCE_LINKS.length; i++) { if (SOURCE_LINKS[i].match.test(hay)) return SOURCE_LINKS[i]; }
  return null;
}

/* ============================================================
 *  TEACHER CONTACT DIRECTORY — remember a teacher's phone/link once,
 *  auto-fill it onto any of their events that arrive without contact.
 *  Storage: a 'teachers' tab [name, phone, url, notes] you can also edit by hand.
 * ============================================================ */
function _teacherKey(s) { return String(s || '').toLowerCase().replace(/[^\wא-ת]+/g, ''); }
function _teacherSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('teachers');
  if (!sh) { sh = ss.insertSheet('teachers'); sh.appendRow(['name', 'phone', 'url', 'notes']); }
  return sh;
}
function _teacherMap() {                       // cached so bulk intake doesn't re-read the sheet each row
  var cache = CacheService.getScriptCache(), c = cache.get('teachers_map');
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  var sh = _teacherSheet(), v = sh.getDataRange().getValues(); v.shift();
  var m = {};
  v.forEach(function (r) { var k = _teacherKey(r[0]); if (k) m[k] = { name: r[0], phone: String(r[1] || '').trim(), url: String(r[2] || '').trim() }; });
  cache.put('teachers_map', JSON.stringify(m), 1500);
  return m;
}
function _teacherUpsert(name, phone, url) {     // learn a contact (fills only blank fields; never overwrites your edits)
  if (!name || (!phone && !(url && /^https?:/i.test(url)))) return;
  var sh = _teacherSheet(), v = sh.getDataRange().getValues(), key = _teacherKey(name), changed = false;
  for (var r = 1; r < v.length; r++) {
    if (_teacherKey(v[r][0]) === key) {
      if (phone && !String(v[r][1] || '').trim()) { sh.getRange(r + 1, 2).setValue(phone); changed = true; }
      if (url && /^https?:/i.test(url) && !String(v[r][2] || '').trim()) { sh.getRange(r + 1, 3).setValue(url); changed = true; }
      if (changed) CacheService.getScriptCache().remove('teachers_map');
      return;
    }
  }
  sh.appendRow([name, phone || '', (url && /^https?:/i.test(url)) ? url : '', '']);
  CacheService.getScriptCache().remove('teachers_map');
}
/* Add/update a teacher by hand from the editor, e.g. addTeacher('שירי פרלמוטר','054-4767443',''). */
function addTeacher(name, phone, url) { _teacherUpsert(name, phone || '', url || ''); return 'saved ' + name; }

/* One-shot: learn contacts from every event that HAS them, then fill every event
 * (by the same teacher) that's MISSING a phone/link. Also seeds the teachers tab.
 * Safe to re-run — never overwrites existing values. */
function applyTeacherContacts() {
  var sh = _sheet(); _ensureCol(sh, 'phone'); var idx = _headerIdx(sh);
  var data = sh.getDataRange().getValues(), dir = _teacherMap();
  for (var r = 1; r < data.length; r++) {                       // pass 1: learn from rows that have contact
    var host = String(data[r][idx.host] || '').trim(); if (!host) continue;
    var k = _teacherKey(host); if (!dir[k]) dir[k] = { name: host, phone: '', url: '' };
    var ph = String(data[r][idx.phone] || '').trim(), u = String(data[r][idx.url] || '').trim();
    if (ph && !dir[k].phone) { dir[k].phone = ph; _teacherUpsert(host, ph, ''); }
    if (/^https?:/i.test(u) && !dir[k].url) { dir[k].url = u; _teacherUpsert(host, '', u); }
  }
  var filled = 0;                                               // pass 2: fill rows that lack contact
  for (var r2 = 1; r2 < data.length; r2++) {
    var host2 = String(data[r2][idx.host] || '').trim(); if (!host2) continue;
    var e = dir[_teacherKey(host2)]; if (!e) continue;
    var changed = false, curPh = String(data[r2][idx.phone] || '').trim(), curU = String(data[r2][idx.url] || '').trim();
    if (!curPh && e.phone) { data[r2][idx.phone] = e.phone; changed = true; }
    if ((!curU || curU === '#') && e.url) { data[r2][idx.url] = e.url; changed = true; }
    if (changed) filled++;
  }
  if (filled) sh.getDataRange().setValues(data);
  Logger.log('applyTeacherContacts: filled ' + filled + ' rows from ' + Object.keys(dir).length + ' teachers');
  return 'filled ' + filled + ' rows from ' + Object.keys(dir).length + ' known teachers';
}

/* ===== VENUE DIRECTORY — remember venue -> city/region, auto-fill on new events ===== */
function _venueKey(s) { return String(s || '').toLowerCase().replace(/[^\wא-ת]+/g, ''); }
function _venueSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('venues');
  if (!sh) { sh = ss.insertSheet('venues'); sh.appendRow(['name', 'city', 'region', 'notes']); }
  return sh;
}
function _venueMap() {
  var cache = CacheService.getScriptCache(), c = cache.get('venues_map');
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  var sh = _venueSheet(), v = sh.getDataRange().getValues(); v.shift();
  var m = {};
  v.forEach(function (r) { var k = _venueKey(r[0]); if (k) m[k] = { name: r[0], city: String(r[1] || '').trim(), region: String(r[2] || '').trim() }; });
  cache.put('venues_map', JSON.stringify(m), 1500);
  return m;
}
function _venueUpsert(name, city, region) {
  if (!name || (!city && !region)) return;
  var sh = _venueSheet(), v = sh.getDataRange().getValues(), key = _venueKey(name), changed = false;
  for (var r = 1; r < v.length; r++) {
    if (_venueKey(v[r][0]) === key) {
      if (city && !String(v[r][1] || '').trim()) { sh.getRange(r + 1, 2).setValue(city); changed = true; }
      if (region && !String(v[r][2] || '').trim()) { sh.getRange(r + 1, 3).setValue(region); changed = true; }
      if (changed) CacheService.getScriptCache().remove('venues_map');
      return;
    }
  }
  sh.appendRow([name, city || '', region || '', '']);
  CacheService.getScriptCache().remove('venues_map');
}
function addVenue(name, city, region) { _venueUpsert(name, city || '', region || ''); return 'saved ' + name; }

var REGIONS = "תל אביב, מרכז, שרון, ירושלים, צפון, דרום, פרדס חנה והסביבה, אונליין, חו״ל";

/* ============================================================
 *  MASTER DIRECTORY (Google Sheet) — the single source of truth for
 *  canonical studio/teacher names, contact/location, and disciplines.
 *  Sheet: one tab, columns:
 *    סוג | שם קנוני | תחום/סוג | טלפון | אתר/קישור | כתובת | עיר | אזור | כתיבים נוספים | הערות
 *  Edit the Sheet anytime; the backend re-reads it (cached ~25 min, or
 *  run refreshDirectory() to reload now). Every new listing is canonicalized
 *  + auto-completed + Gaga-tagged from it.
 * ============================================================ */
var DIRECTORY_SHEET_ID = '1SEcP8wB-Oxhvg-9laVCjsWZYKpvVoMi_p3WivGqDvPA';
function _dirNorm(s){ return String(s == null ? '' : s).toLowerCase().replace(/[^0-9a-zא-ת]+/g, ''); }
function _loadDirectory(){
  var cache = CacheService.getScriptCache(), c = cache.get('zuzu_dir');
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  var out = { teachers: {}, venues: {} };
  try {
    var sh = SpreadsheetApp.openById(DIRECTORY_SHEET_ID).getSheets()[0];
    var vals = sh.getDataRange().getValues();
    for (var r = 1; r < vals.length; r++) {
      var row = vals[r], kind = String(row[0] || '').trim(), name = String(row[1] || '').trim();
      if (!name) continue;
      var obj = { name: name, field: String(row[2] || '').trim(), phone: String(row[3] || '').trim(),
        url: String(row[4] || '').trim(), address: String(row[5] || '').trim(),
        city: String(row[6] || '').trim(), region: String(row[7] || '').trim() };
      var bucket = (kind.indexOf('מור') >= 0) ? out.teachers : out.venues;   // "מורה/ה" vs "מקום/מותג"
      [name].concat(String(row[8] || '').split(',')).forEach(function (k) { var kk = _dirNorm(k); if (kk) bucket[kk] = obj; });
    }
    cache.put('zuzu_dir', JSON.stringify(out), 1500);
  } catch (e) { /* sheet unreachable -> empty directory, no-op */ }
  return out;
}
/** Force a reload of the directory cache (run after editing the Sheet). */
function refreshDirectory(){
  CacheService.getScriptCache().remove('zuzu_dir');
  var d = _loadDirectory();
  var msg = 'directory reloaded: ' + Object.keys(d.teachers).length + ' teacher keys, ' + Object.keys(d.venues).length + ' venue keys';
  Logger.log(msg); return msg;
}
/** Canonicalize + auto-fill + Gaga-tag one incoming event from the master directory. */
function _applyDirectory(incoming){
  var dir = _loadDirectory();
  if (incoming.host) {
    var t = dir.teachers[_dirNorm(incoming.host)];
    if (t) {
      incoming.host = t.name;                                              // canonical spelling
      if ((!incoming.url || incoming.url === '#') && t.url) incoming.url = t.url;
      if (!incoming.phone && t.phone) incoming.phone = t.phone;
      if (/גאגא/.test(t.field)) {                                          // known Gaga teacher -> tag גאגא
        incoming.category = 'גאגא';
        var ti = String(incoming.title || '').trim();
        if (!ti || _dirNorm(ti) === _dirNorm(t.name)) {                    // blank title, or title is just the teacher's name
          incoming.title = 'שיעור גאגא' + (incoming.venue ? ' — ' + incoming.venue : '');
        }
      } else if (!incoming.category && t.field) {
        incoming.category = t.field.split(',')[0].trim();                  // first discipline as a fallback
      }
    }
  }
  if (incoming.venue) {
    var v = dir.venues[_dirNorm(incoming.venue)];
    if (v) {
      incoming.venue = v.name;                                            // canonical spelling
      if (!incoming.city && v.city) incoming.city = v.city;
      if (!incoming.region && v.region) incoming.region = v.region;
      if ((!incoming.url || incoming.url === '#') && v.url) incoming.url = v.url;
      if (!incoming.phone && v.phone) incoming.phone = v.phone;
    }
  }
  return incoming;
}
/* One-shot: re-normalize EVERY existing row's host/venue to the directory's canonical
 * spelling (and fill blanks). Run once after the directory is filled; safe to re-run. */
function normalizeStoreFromDirectory(){
  var sh = _sheet(), idx = _headerIdx(sh), dir = _loadDirectory();
  var data = sh.getDataRange().getValues(), changed = 0;
  for (var r = 1; r < data.length; r++) {
    var row = data[r], touched = false;
    if (idx.host !== undefined) { var t = dir.teachers[_dirNorm(row[idx.host])]; if (t && row[idx.host] !== t.name) { row[idx.host] = t.name; touched = true; } }
    if (idx.venue !== undefined) { var v = dir.venues[_dirNorm(row[idx.venue])]; if (v && row[idx.venue] !== v.name) { row[idx.venue] = v.name; touched = true; } }
    if (touched) changed++;
  }
  if (changed) sh.getDataRange().setValues(data);
  Logger.log('normalizeStoreFromDirectory: ' + changed + ' rows'); return 'normalized ' + changed + ' rows to canonical names';
}

// Option B (share-to-Gmail) labels
var INBOX_LABEL = 'zuzu-inbox';
var DONE_LABEL = 'zuzu-done';

function _sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(COLS); }
  return sh;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.update_id !== undefined) return _telegram(data); // Telegram bot webhook (forward a poster)
    if (data.action === 'scan') return _json(_scan(data));   // screenshot → events
    if (data.action === 'track') return _json(_track(data)); // lightweight click/filter analytics
    if (data.action === 'review_list') return _reviewList(data.token, data.filter);  // review page: fetch a bucket
    if (data.action === 'approve' || data.action === 'reject' || data.action === 'save' || data.action === 'unreview')
      return _json(_review(data));                                               // review page: act on one row
    if (data.action === 'review_add') return _json(_reviewAdd(data));            // review page: add from screenshot/text
    if (data.action === 'review_add_url') return _json(_reviewAddUrl(data));      // review page: add from a link
    if (data.action === 'review_verify') return _json(_reviewVerify(data));       // review page: research an event online
    if (data.action === 'review_enrich') return _json(_reviewEnrich(data));       // review page: extract details from a source to fill a card
    if (data.action === 'delete') return _json(_reviewDelete(data));             // review page: permanently remove a row
    // otherwise: a normal event submission — require at least a title and a date,
    // so empty/garbage POSTs (bots probing the public endpoint) don't create blank rows
    if (!data.title || !String(data.title).trim() || !data.date) {
      return _json({ ok: false, error: 'missing title/date' });
    }
    // Step 3: insert-or-MERGE instead of blind append, so the same event from a
    // scrape and a newsletter collapses into one row (dedup key = date|title|venue).
    var res = _submitEvent(data, false, data.source || 'submit');
    return _json({ ok: true, dedup: res.status, row: res.row });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.pending) return _reviewList(e.parameter.token, e.parameter.filter);  // review page feed
  var sh = _sheet();
  var rows = sh.getDataRange().getValues();
  var header = rows.shift() || [];
  var idx = {}; header.forEach(function (h, i) { idx[String(h).trim()] = i; });  // trim: a stray space in a header no longer blanks the feed
  var _today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');  // freshness: drop past events
  var out = [];
  rows.forEach(function (r) {
    if (r[idx.approved] !== true) return;
    if (!r[idx.title] || !r[idx.date]) return;   // skip blank/placeholder rows
    var base = {
      time: _t(r[idx.time]), time_end: (idx.time_end !== undefined ? _t(r[idx.time_end]) : ''), title: r[idx.title],
      category: r[idx.category], venue: r[idx.venue], city: r[idx.city] || null,
      region: r[idx.region], url: r[idx.url] || '#', price: r[idx.price] || null,
      image: null, recurring: false
    };
    if (r[idx.host]) base.host = r[idx.host];
    if (idx.type !== undefined && r[idx.type]) { base.type = r[idx.type]; base.format = r[idx.type]; }
    if (idx.phone !== undefined && r[idx.phone]) base.phone = r[idx.phone];
    var rep = idx.repeat !== undefined ? String(r[idx.repeat] || '').trim().toLowerCase() : '';
    var datesStr = idx.dates !== undefined ? String(r[idx.dates] || '').trim() : '';
    var teachersStr = idx.teachers !== undefined ? String(r[idx.teachers] || '').trim() : '';   // rotating-teacher slot schedule
    if (datesStr) {
      // explicit list of dates (bi-weekly / irregular / monthly) — one card per future date
      _parseDatesList(datesStr).forEach(function (iso) { if (iso >= _today) _pushOcc(out, base, iso, teachersStr); });
    } else if (rep === 'weekly' || rep === 'biweekly') {
      // expand one row into a dated session per upcoming week/fortnight (join-late friendly)
      var step = rep === 'biweekly' ? 14 : 7;
      var cnt = idx.count !== undefined ? parseInt(r[idx.count], 10) : 0;
      var occW = (cnt > 0)                                       // "number of classes" wins over an end date
        ? _stepOccurrences(_d(r[idx.date]), step, cnt, _today)
        : _weeklyOccurrences(_d(r[idx.date]), (idx.date_end !== undefined && r[idx.date_end]) ? _d(r[idx.date_end]) : '', _today, step);
      occW.forEach(function (iso) { _pushOcc(out, base, iso, teachersStr); });
    } else if (rep === 'monthly') {
      // once a month, on the same nth-weekday as the start (e.g. "third Saturday")
      var cntM = idx.count !== undefined ? parseInt(r[idx.count], 10) : 0;
      var occM = (cntM > 0)
        ? _monthlyCountOccurrences(_d(r[idx.date]), cntM, _today)
        : _monthlyOccurrences(_d(r[idx.date]), (idx.date_end !== undefined && r[idx.date_end]) ? _d(r[idx.date_end]) : '', _today);
      occM.forEach(function (iso) { _pushOcc(out, base, iso, teachersStr); });
    } else {
      var _ds = _d(r[idx.date]);
      var _de = (idx.date_end !== undefined && r[idx.date_end]) ? _d(r[idx.date_end]) : _ds;
      if ((_de || _ds) < _today) return;           // one-off fully in the past -> don't serve
      base.date = _ds;
      if (r[idx.date_end]) base.date_end = _d(r[idx.date_end]);
      out.push(base);
    }
  });
  return _json(out);
}

function _shallow(o) { var c = {}; for (var k in o) if (o.hasOwnProperty(k)) c[k] = o[k]; return c; }
/* Push one recurring occurrence; if the row is a rotating-teacher SLOT (has a
 * teachers schedule), set that date's teacher (or "המורה יתעדכן" when not listed). */
function _pushOcc(out, base, iso, teachersStr) {
  var ev = _shallow(base); ev.date = iso; ev.recurring = true;
  if (teachersStr) { var tt = _teacherForDate(teachersStr, iso); ev.host = tt || 'המורה יתעדכן'; }
  out.push(ev);
}
/* Teacher for a given ISO date from a schedule like "1.9=יערה מוזס; 8.9=קורליה לך".
 * Separators: ; or newline. Date part accepts d.m / d/m / yyyy-mm-dd. */
function _teacherForDate(sched, iso) {
  if (!sched) return '';
  var lines = String(sched).split(/[;\n]+/);
  for (var i = 0; i < lines.length; i++) {
    var eq = lines[i].indexOf('=');
    if (eq < 0) continue;
    if (_normScheduleDate(lines[i].slice(0, eq).trim()) === iso) return lines[i].slice(eq + 1).trim();
  }
  return '';
}
function _normScheduleDate(p) { var a = _parseDatesList(p); return a.length ? a[0] : ''; }
function _isoToDate(iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function _dateToIso(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
/* Recurring occurrences every stepDays (7=weekly, 14=biweekly) on the weekday of
 * startISO, from max(today,start) to end. Open-ended caps at ~90 days ahead; a
 * course (endISO) at 150. */
function _weeklyOccurrences(startISO, endISO, todayISO, stepDays) {
  if (!startISO) return [];
  var step = stepDays || 7;
  var start = _isoToDate(startISO), today = _isoToDate(todayISO);
  var cap = new Date(today.getTime() + (endISO ? 150 : 90) * 864e5);
  var end = endISO ? _isoToDate(endISO) : cap;
  if (end > cap) end = cap;
  var occ = new Date(start.getTime()), from = start > today ? start : today, out = [], guard = 0;
  while (occ < from) occ = new Date(occ.getTime() + step * 864e5);
  while (occ <= end && guard < 60) { out.push(_dateToIso(occ)); occ = new Date(occ.getTime() + step * 864e5); guard++; }
  return out;
}

/* Exactly `count` sessions every stepDays from the start (a course of N classes),
 * keeping only those from today on (join-late friendly). */
function _stepOccurrences(startISO, stepDays, count, todayISO) {
  if (!startISO || !(count > 0)) return [];
  var start = _isoToDate(startISO), out = [];
  for (var k = 0; k < count && k < 200; k++) {
    var iso = _dateToIso(new Date(start.getTime() + k * stepDays * 864e5));
    if (iso >= todayISO) out.push(iso);
  }
  return out;
}
/* Exactly `count` monthly sessions (same nth-weekday-of-month as start), upcoming only. */
function _monthlyCountOccurrences(startISO, count, todayISO) {
  if (!startISO || !(count > 0)) return [];
  var start = _isoToDate(startISO), weekday = start.getDay(), ordinal = Math.floor((start.getDate() - 1) / 7) + 1;
  var out = [], y = start.getFullYear(), m = start.getMonth(), made = 0, guard = 0;
  while (made < count && guard < 60) {
    var d = _nthWeekdayOfMonth(y, m, weekday, ordinal);
    if (d) { made++; if (_dateToIso(d) >= todayISO) out.push(_dateToIso(d)); }
    m++; if (m > 11) { m = 0; y++; } guard++;
  }
  return out;
}
/* The date of the Nth given weekday in a month (e.g. 3rd Saturday). null if that
 * month has no such occurrence (e.g. a 5th Saturday). */
function _nthWeekdayOfMonth(year, month0, weekday, ordinal) {
  var first = new Date(year, month0, 1);
  var shift = (weekday - first.getDay() + 7) % 7;
  var day = 1 + shift + (ordinal - 1) * 7;
  var d = new Date(year, month0, day);
  return d.getMonth() === month0 ? d : null;
}
/* Monthly occurrences repeating the same nth-weekday-of-month as startISO
 * ("third Saturday of every month"). Open-ended caps ~4 months out; a course
 * (endISO) up to ~7 months. */
function _monthlyOccurrences(startISO, endISO, todayISO) {
  if (!startISO) return [];
  var start = _isoToDate(startISO), today = _isoToDate(todayISO);
  var weekday = start.getDay(), ordinal = Math.floor((start.getDate() - 1) / 7) + 1;
  var cap = new Date(today.getTime() + (endISO ? 210 : 120) * 864e5);
  var end = endISO ? _isoToDate(endISO) : cap;
  if (end > cap) end = cap;
  var from = start > today ? start : today, out = [], guard = 0;
  var y = start.getFullYear(), m = start.getMonth();
  while (guard < 24) {
    var d = _nthWeekdayOfMonth(y, m, weekday, ordinal);
    if (d) { if (d > end) break; if (d >= from) out.push(_dateToIso(d)); }
    m++; if (m > 11) { m = 0; y++; } guard++;
  }
  return out;
}

/* Parse a free-form list of dates ("1.9, 15.9, 29.9" or ISO or newline-separated)
 * into ISO yyyy-MM-dd strings. A year-less date assumes the nearest upcoming year. */
function _parseDatesList(s) {
  if (!s) return [];
  var now = new Date(), todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var out = [];
  String(s).split(/[,;\n]+/).forEach(function (p) {
    p = p.trim(); if (!p) return;
    var iso = null, m = p.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) { iso = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2); }
    else {
      var d = p.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?$/);
      if (d) {
        var day = +d[1], mon = +d[2], yr = d[3] ? +d[3] : null;
        if (yr && yr < 100) yr += 2000;
        if (!yr) { yr = now.getFullYear(); if (new Date(yr, mon - 1, day) < todayMid) yr++; }
        iso = yr + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
      }
    }
    if (iso) out.push(iso);
  });
  return out;
}

/* ============================================================
 *  REVIEW PAGE — a private admin feed + approve/reject endpoint
 *  Read : GET  ?pending=1&token=XXX   -> pending (approved!=TRUE, not rejected) rows
 *  Write: POST {action:'approve'|'reject'|'save', token, uid, fields?, reason?}
 *  Gated by a shared secret in Script Property REVIEW_TOKEN. Keep the URL private.
 * ============================================================ */
function _reviewToken() { return PropertiesService.getScriptProperties().getProperty('REVIEW_TOKEN') || ''; }
function _reviewAuth(t) { var want = _reviewToken(); return !!want && String(t) === want; }

function _reviewList(token, filter) {
  if (!_reviewAuth(token)) return _json({ ok: false, error: 'unauthorized' });
  filter = filter || 'pending';   // 'pending' | 'past' | 'approved' | 'rejected'
  var sh = _sheet();
  _ensureCol(sh, 'reason'); _ensureCol(sh, 'review'); _ensureCol(sh, 'type'); _ensureCol(sh, 'phone'); _ensureCol(sh, 'date_end'); _ensureCol(sh, 'repeat'); _ensureCol(sh, 'dates'); _ensureCol(sh, 'time_end'); _ensureCol(sh, 'count'); _ensureCol(sh, 'teachers');
  _backfillUids(sh);   // guarantee every row has a uid so approve/reject can target it (fixes "won't leave the queue")
  var rows = sh.getDataRange().getValues(), header = rows.shift() || [];
  var idx = {}; header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var SRC = { email: 'וואטסאפ/אימייל — ממתין לאישור', bodyways: 'סריקת bodyways — תאריך/סיווג לא ודאי',
    submit: 'טופס באתר — ממתין לאישור', newsletter: 'ניוזלטר — ממתין לאישור',
    manual: 'הוזן ידנית בריוויוער — ממתין לאישור', link: 'נמשך מקישור — ממתין לאישור' };
  var out = [], counts = { pending: 0, past: 0, approved: 0, rejected: 0, duplicates: 0 };
  var approvedByKey = {};
  function mkEv(r, bucket, ds, deISO, rep) {
    var src = String(idx.source !== undefined ? (r[idx.source] || '') : '');
    return {
      uid: idx.uid !== undefined ? r[idx.uid] : '',
      source: src, bucket: bucket,
      reason: (idx.reason !== undefined && r[idx.reason]) ? r[idx.reason] : (SRC[src] || (src ? ('מקור: ' + src) : 'ממתין לאישור')),
      date: ds, time: _t(r[idx.time]), time_end: (idx.time_end !== undefined ? _t(r[idx.time_end]) : ''), title: r[idx.title] || '',
      host: r[idx.host] || '', category: r[idx.category] || '',
      type: (idx.type !== undefined ? r[idx.type] : '') || '',
      date_end: deISO, repeat: rep, dates: (idx.dates !== undefined ? String(r[idx.dates] || '') : ''),
      count: (idx.count !== undefined ? String(r[idx.count] || '') : ''),
      teachers: (idx.teachers !== undefined ? String(r[idx.teachers] || '') : ''),
      venue: r[idx.venue] || '', city: r[idx.city] || '', region: r[idx.region] || '',
      url: r[idx.url] || '', phone: (idx.phone !== undefined ? r[idx.phone] : '') || '',
      price: r[idx.price] || '', past: bucket === 'past'
    };
  }
  rows.forEach(function (r) {
    if (!r[idx.title]) return;
    var isApproved = r[idx.approved] === true;
    var isRejected = idx.review !== undefined && String(r[idx.review] || '') === 'rejected';
    var ds = _d(r[idx.date]);
    var deISO = (idx.date_end !== undefined && r[idx.date_end]) ? _d(r[idx.date_end]) : '';
    var rep = idx.repeat !== undefined ? String(r[idx.repeat] || '').trim().toLowerCase() : '';
    var recurringActive = rep === 'weekly' && (!deISO || deISO >= today);   // a live recurring class isn't "past"
    var effEnd = deISO || ds;
    var isPast = !isApproved && !isRejected && !recurringActive && effEnd && effEnd < today;
    var bucket = isApproved ? 'approved' : (isRejected ? 'rejected' : (isPast ? 'past' : 'pending'));
    counts[bucket]++;
    if (isApproved) {   // collect for duplicate detection: same date + same teacher
      var hk = String(r[idx.host] || '').replace(/\s+/g, '').toLowerCase();
      if (hk && ds) { var gk = ds + '|' + hk; (approvedByKey[gk] = approvedByKey[gk] || []).push(mkEv(r, bucket, ds, deISO, rep)); }
    }
    if (bucket === filter && filter !== 'duplicates') out.push(mkEv(r, bucket, ds, deISO, rep));
  });
  var dupOut = [];
  Object.keys(approvedByKey).forEach(function (gk) {
    var g = approvedByKey[gk];
    if (g.length > 1) { counts.duplicates += g.length; g.forEach(function (e) { e.dupGroup = gk; e.dupInfo = e.date + ' · ' + (e.host || ''); }); dupOut = dupOut.concat(g); }
  });
  if (filter === 'duplicates') {
    dupOut.sort(function (a, b) { return String(a.dupGroup).localeCompare(String(b.dupGroup)) || String(a.title).localeCompare(String(b.title)); });
    out = dupOut;
  } else {
    // soonest first; undated rows sink to the bottom (they need a date anyway)
    out.sort(function (a, b) { return (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'); });
    if (out.length > 400) out = out.slice(0, 400);   // safety cap on the archive views
  }
  var tMap = _teacherMap(), teachers = Object.keys(tMap).map(function (k) { return tMap[k]; });
  var vMap = _venueMap(), venues = Object.keys(vMap).map(function (k) { return vMap[k]; });
  return _json({
    ok: true, events: out, filter: filter, counts: counts,
    categories: CATEGORIES.split(',').map(function (s) { return s.trim(); }),
    types: TYPES.split(',').map(function (s) { return s.trim(); }),
    regions: REGIONS.split(',').map(function (s) { return s.trim(); }),
    teachers: teachers, venues: venues
  });
}

function _review(data) {
  if (!_reviewAuth(data.token)) return { ok: false, error: 'unauthorized' };
  var sh = _sheet();
  _ensureCol(sh, 'reason'); var reviewCol = _ensureCol(sh, 'review'); var lvCol = _ensureCol(sh, 'last_verified');
  _ensureCol(sh, 'date_end'); _ensureCol(sh, 'repeat'); _ensureCol(sh, 'dates'); _ensureCol(sh, 'time_end'); _ensureCol(sh, 'count'); _ensureCol(sh, 'teachers');
  var idx = _headerIdx(sh);
  var row = _findRowByUid(sh, data.uid);
  if (row < 0) return { ok: false, error: 'not found' };
  var _now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (data.action === 'reject') {
    if (idx.approved !== undefined) sh.getRange(row, idx.approved + 1).setValue(false);   // also pull it off the live site
    if (idx.reason !== undefined) sh.getRange(row, idx.reason + 1).setValue(data.reason || 'נדחה');
    sh.getRange(row, reviewCol + 1).setValue('rejected');
    return { ok: true, action: 'reject' };
  }
  if (data.action === 'unreview') {                       // move an approved/rejected row back to the pending queue
    if (idx.approved !== undefined) sh.getRange(row, idx.approved + 1).setValue(false);
    sh.getRange(row, reviewCol + 1).setValue('');
    return { ok: true, action: 'unreview' };
  }
  var fields = data.fields || {};   // approve/save: write edited fields, and LOG each change so tagging can learn
  var cur = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var titleNow = (idx.title !== undefined ? cur[idx.title] : '') || fields.title || '';
  var srcNow = (idx.source !== undefined ? cur[idx.source] : '') || '';
  var corr = [];
  ['date', 'time', 'time_end', 'title', 'host', 'category', 'type', 'venue', 'city', 'region', 'url', 'phone', 'price', 'date_end', 'repeat', 'dates', 'count', 'teachers'].forEach(function (f) {
    if (idx[f] === undefined || fields[f] === undefined) return;
    var oldV = cur[idx[f]], newV = fields[f];
    if (String(oldV == null ? '' : oldV).trim() === String(newV).trim()) return;   // unchanged
    sh.getRange(row, idx[f] + 1).setValue(newV);                                    // write the fix
    corr.push([_now, data.uid, titleNow, f, oldV, newV, srcNow]);                   // remember old -> new
  });
  if (corr.length) { var cs = _corrSheet(); cs.getRange(cs.getLastRow() + 1, 1, corr.length, 7).setValues(corr); }
  if (data.action === 'approve') {
    sh.getRange(row, idx.approved + 1).setValue(true);
    if (lvCol !== undefined) sh.getRange(row, lvCol + 1).setValue(_now);
    return { ok: true, action: 'approve' };
  }
  return { ok: true, action: 'save' };
}

/* Permanently remove a row from the sheet (hard delete, no undo). Used by the
 * 🗑 button in the reviewer for genuine junk that shouldn't linger in "נדחו". */
function _reviewDelete(data) {
  if (!_reviewAuth(data.token)) return { ok: false, error: 'unauthorized' };
  var sh = _sheet();
  var row = _findRowByUid(sh, data.uid);
  if (row < 0) return { ok: false, error: 'not found' };
  sh.deleteRow(row);
  return { ok: true, action: 'delete' };
}

/* Add-from-the-reviewer: a screenshot and/or pasted text -> Claude vision (_scan)
 * -> _submitEvent(approved=FALSE) so it lands in the pending queue (dedup + rules apply). */
function _reviewAdd(data) {
  if (!_reviewAuth(data.token)) return { ok: false, error: 'unauthorized' };
  var hasImg = !!(data.image && String(data.image).length > 20);
  var hasTxt = !!(data.text && String(data.text).trim());
  if (!hasImg && !hasTxt) return { ok: false, error: 'no input' };
  var res = _scan({ image: data.image || '', mime: data.mime || 'image/png', text: data.text || '' });
  if (!res || res.error) return { ok: false, error: (res && res.error) || 'scan failed' };
  var evs = res.events || [], n = 0, uids = [];
  evs.forEach(function (ev) { var r = _submitEvent(ev, false, 'manual'); n++; if (r && r.uid) uids.push(r.uid); });
  return { ok: true, added: n, events: evs, uids: uids };
}

/* Research one pending event online (Claude + web search): is the teacher/event
 * real & current, and what are the missing details (link, phone, time)? Returns a
 * verdict + enrichment the page can apply. Uses the web_search tool (small $ per call). */
function _reviewVerify(data) {
  if (!_reviewAuth(data.token)) return { ok: false, error: 'unauthorized' };
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'מפתח ה-AI לא הוגדר' };
  var sh = _sheet(), idx = _headerIdx(sh), row = _findRowByUid(sh, data.uid);
  if (row < 0) return { ok: false, error: 'not found' };
  var v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var ev = { title: v[idx.title], host: idx.host !== undefined ? v[idx.host] : '', venue: idx.venue !== undefined ? v[idx.venue] : '',
    city: idx.city !== undefined ? v[idx.city] : '', date: _d(v[idx.date]) };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var prompt =
    'בדוק באינטרנט אם אירוע/מורה התנועה הבא בישראל עדיין אקטואלי, ומצא פרטים חסרים.\n' +
    'כותרת: ' + (ev.title || '') + '\nמנחה: ' + (ev.host || '?') + '\nמקום: ' + (ev.venue || '?') + ' ' + (ev.city || '') + '\nתאריך בזוזו: ' + (ev.date || '?') + '\n' +
    'התאריך היום ' + today + '. חפש את המנחה/האירוע (אתר, פייסבוק, אינסטגרם, פלטפורמת כרטוס) והערך האם המנחה פעיל/ה ב-2025–2026 והאם האירוע נראה עדכני.\n' +
    'החזר אך ורק JSON תקין, בלי טקסט נוסף: {"status":"active|uncertain|stale","url":"קישור הרשמה/מידע עדכני או \\"\\"","phone":"טלפון או \\"\\"","time":"HH:mm או \\"\\"","note":"משפט קצר בעברית עם ההסבר"}';
  var payload = { model: 'claude-sonnet-4-6', max_tokens: 1200,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] };
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var body;
  try { body = JSON.parse(resp.getContentText()); } catch (e) { return { ok: false, error: 'תשובה לא תקינה' }; }
  if (body && body.type === 'error') return { ok: false, error: (body.error && body.error.message) || 'AI error' };
  var txt = '';
  (body.content || []).forEach(function (b) { if (b.type === 'text') txt += b.text; });
  var m = txt.match(/\{[\s\S]*\}/), r = {};
  if (m) { try { r = JSON.parse(m[0]); } catch (e) {} }
  return { ok: true, result: r };
}

/* Add-from-a-link: fetch the page, pull schema.org events + visible text,
 * extract with Claude, queue each as pending. Best for real event pages
 * (studios, ticketing). Login-gated pages (Facebook/Instagram) usually won't work. */
/* Enrich ONE event being reviewed: read an attached screenshot / PDF / free text /
 * link, extract the event details, and RETURN them (does NOT create or write any
 * row). The reviewer fills the current card's empty fields from `event`. */
function _reviewEnrich(data) {
  if (!_reviewAuth(data.token)) return { ok: false, error: 'unauthorized' };
  var url = String(data.url || '').trim();
  var evs = [];
  if (/^https?:\/\//i.test(url)) {
    var html = '';
    try {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZuzuBot/1.0)' } });
      if (resp.getResponseCode() >= 400) return { ok: false, error: 'העמוד החזיר שגיאה ' + resp.getResponseCode() };
      html = resp.getContentText();
    } catch (e) { return { ok: false, error: 'טעינת העמוד נכשלה: ' + e }; }
    if (!html) return { ok: false, error: 'עמוד ריק' };
    var ld = _extractJsonLd(html), text = _htmlToText(html).slice(0, 12000), links = _harvestLinks(html);
    if (!ld && text.length < 40) return { ok: false, error: 'לא נמצא תוכן קריא בעמוד (אולי דורש התחברות)' };
    var r = _extractEventsFromUrl(text, ld, links, url);
    if (!r || r.error) return { ok: false, error: (r && r.error) || 'החילוץ נכשל' };
    evs = r.events || [];
    if (evs[0] && !evs[0].url) evs[0].url = url;
  } else {
    var hasImg = !!(data.image && String(data.image).length > 20);
    var hasTxt = !!(data.text && String(data.text).trim());
    if (!hasImg && !hasTxt) return { ok: false, error: 'לא צורף מקור (טקסט / תמונה / קישור)' };
    var s = _scan({ image: data.image || '', mime: data.mime || 'image/png', text: data.text || '' });
    if (!s || s.error) return { ok: false, error: (s && s.error) || 'החילוץ נכשל' };
    evs = s.events || [];
  }
  return { ok: true, event: evs[0] || null, count: evs.length };
}

function _reviewAddUrl(data) {
  if (!_reviewAuth(data.token)) return { ok: false, error: 'unauthorized' };
  var url = String(data.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'קישור לא תקין' };
  var html = '';
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZuzuBot/1.0)' } });
    if (resp.getResponseCode() >= 400) return { ok: false, error: 'העמוד החזיר שגיאה ' + resp.getResponseCode() };
    html = resp.getContentText();
  } catch (e) { return { ok: false, error: 'טעינת העמוד נכשלה: ' + e }; }
  if (!html) return { ok: false, error: 'עמוד ריק' };
  var ld = _extractJsonLd(html), text = _htmlToText(html).slice(0, 12000), links = _harvestLinks(html);
  if (!ld && text.length < 40) return { ok: false, error: 'לא נמצא תוכן קריא בעמוד (אולי דורש התחברות)' };
  var res = _extractEventsFromUrl(text, ld, links, url);
  if (!res || res.error) return { ok: false, error: (res && res.error) || 'החילוץ נכשל' };
  var evs = res.events || [], n = 0, uids = [];
  evs.forEach(function (ev) { if (!ev.url) ev.url = url; var r = _submitEvent(ev, false, 'link'); n++; if (r && r.uid) uids.push(r.uid); });
  return { ok: true, added: n, events: evs, uids: uids };
}
function _htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
    .replace(/\s+/g, ' ').trim();
}
function _extractJsonLd(html) {
  var out = [], re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(html))) { out.push(m[1].trim()); if (out.join('').length > 6000) break; }
  return out.join('\n').slice(0, 6000);
}
/* harvest anchor (text -> href) pairs so the model can attach the right
 * registration/tickets link to each event (the newsletter path can't see these). */
function _harvestLinks(html) {
  var out = [], seen = {}, re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) && out.length < 40) {
    var href = m[1], txt = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/^https?:/i.test(href)) continue;
    if (/facebook\.com\/(sharer|plugins)|api\.whatsapp|twitter\.com\/intent|\.(png|jpe?g|gif|svg|css|js|ico)(\?|#|$)/i.test(href)) continue;
    if (seen[href]) continue; seen[href] = 1;
    out.push((txt ? txt.slice(0, 60) : '(link)') + ' -> ' + href);
  }
  return out.join('\n').slice(0, 3000);
}
function _extractEventsFromUrl(text, ld, links, url) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { events: [], error: 'מפתח ה-AI לא הוגדר' };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var prompt =
    "אתה מחלץ אירועי ריקוד/תנועה מתוכן של עמוד אינטרנט (עברית/אנגלית). החזר אך ורק מערך JSON תקין. כל פריט:\n" +
    '{"date":"YYYY-MM-DD","time":"HH:mm","time_end":"HH:mm שעת סיום או \\"\\"","title":"...","host":"","category":"תחום","type":"סוג","venue":"","city":"","region":"","price":"","url":"קישור ישיר אם קיים","phone":"","repeat":"weekly|biweekly|monthly או \\"\\"","dates":"רשימת תאריכים או \\"\\"","date_end":"YYYY-MM-DD או \\"\\"","count":"מספר מפגשים או \\"\\""}\n' +
    "category (תחום): " + CATEGORIES + ".\n" +
    "type (סוג): " + TYPES + ". שים לב: ג'אם/סדנה הם type, לא category.\n" +
    "אזורים: " + REGIONS + ".\n" +
    "time_end = שעת סיום אם מצוינת, אחרת \"\".\n" +
    "חזרתיות: אם זה קורס/סדרה — repeat=weekly/biweekly/monthly לקצב קבוע (date=מפגש ראשון), או dates=רשימת התאריכים אם מפורטים. count=מספר מפגשים אם צוין, date_end=תאריך אחרון אם צוין. אירוע בודד => השאר ריקים.\n" +
    "התאריך היום " + today + ". הוצא רק אירועים עם תאריך קונקרטי (עתידי, או תאריך התחלה של סדרה). אם אין אף אירוע מתוארך — החזר [].\n" +
    "כתובת העמוד: " + url + "\n" +
    "url — בחר עבור כל אירוע את קישור ההרשמה/כרטיסים הנכון מתוך רשימת הקישורים למטה (התאם לפי הכותרת/המקום). אם אין מתאים — השאר url ריק.\n" +
    (ld ? ("נתוני schema.org מהעמוד (מהימנים לתאריכים/מחיר/מיקום):\n" + ld + "\n\n") : "") +
    (links ? ("קישורים בעמוד:\n" + links + "\n\n") : "") +
    "טקסט העמוד:\n" + text;
  var payload = { model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] };
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  try {
    var body = JSON.parse(resp.getContentText());
    if (body && body.type === 'error') return { events: [], error: (body.error && body.error.message) || 'AI error' };
    var txt = (body.content && body.content[0] && body.content[0].text) || '';
    var mm = txt.match(/\[[\s\S]*\]/);
    return { events: mm ? JSON.parse(mm[0]) : [] };
  } catch (e) { return { events: [], error: String(e) }; }
}

/* The learning ledger: every fix you make at review time is appended here as
 * (field, from -> to). This is the corpus we later turn into tagging rules /
 * few-shot examples. Nothing auto-changes tagging yet — we capture first. */
function _corrSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('corrections');
  if (!sh) { sh = ss.insertSheet('corrections'); sh.appendRow(['timestamp', 'uid', 'title', 'field', 'from', 'to', 'source']); }
  return sh;
}

/* Run from the editor to see your most common fixes, most-frequent first.
 * e.g. "12×  category: \"מובמנט\" -> \"ריקוד חופשי\"" — those become rules. */
function correctionsSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('corrections');
  if (!sh || sh.getLastRow() < 2) { Logger.log('no corrections logged yet'); return 'no corrections logged yet'; }
  var v = sh.getDataRange().getValues(); v.shift();
  var tz = Session.getScriptTimeZone();
  function _cc(field, x) {                       // format Date cells so date/time fixes are legible
    if (x instanceof Date) return (field === 'time' || field === 'time_end')
      ? Utilities.formatDate(x, tz, 'HH:mm') : Utilities.formatDate(x, tz, 'yyyy-MM-dd');
    return String(x == null ? '' : x).trim();
  }
  var counts = {};
  v.forEach(function (r) {
    var field = r[3], from = _cc(field, r[4]), to = _cc(field, r[5]);
    if (!to || from === to) return;             // skip empty + coerced-identical date/time rows
    var key = field + ': "' + from + '" -> "' + to + '"';
    counts[key] = (counts[key] || 0) + 1;
  });
  var arr = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  var out = arr.slice(0, 40).map(function (x) { return x[1] + '×  ' + x[0]; }).join('\n');
  Logger.log(out || 'no field changes logged'); return out;
}

/* ============================================================
 *  ONE-TIME MIGRATION — split discipline vs format
 *  Old rows put a FORMAT word (ג'אם / סדנה) into `category`.
 *  This moves it into `type` and recovers the discipline from
 *  the title. Only touches rows whose category is a format word;
 *  proper disciplines are left untouched. Safe to run more than once.
 *  Run it once from the editor after pasting this file.
 * ============================================================ */
function retagTypes() {
  var sh = _sheet();
  _ensureCol(sh, 'type');
  var idx = _headerIdx(sh);
  var data = sh.getDataRange().getValues();
  var typeWords = TYPES.split(',').map(function (s) { return s.trim(); });
  var discWords = CATEGORIES.split(',').map(function (s) { return s.trim(); }).filter(function (w) { return w && w !== 'אחר'; });
  var moved = 0;
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var cat = String(row[idx.category] || '').trim();
    if (typeWords.indexOf(cat) === -1) continue;              // already a discipline (or blank) — leave alone
    if (!String(row[idx.type] || '').trim()) row[idx.type] = cat;   // stash the format word in `type`
    var title = String(row[idx.title] || ''), found = '';
    for (var i = 0; i < discWords.length; i++) { if (title.indexOf(discWords[i]) >= 0) { found = discWords[i]; break; } }
    row[idx.category] = found || 'אחר';                       // recover discipline from title, else 'אחר'
    moved++;
  }
  if (moved) sh.getDataRange().setValues(data);
  Logger.log('retagTypes: moved ' + moved);
  return 'retagTypes: moved ' + moved + ' rows (format word out of category into type).';
}

/* One-time: re-tag DISCIPLINE (category) from the keyword rules above.
 *  - a positive keyword match -> set that discipline
 *  - a row currently 'מובמנט' with NO movement-keyword match -> 'אחר'
 *    (clears the old over-tagging; מובמנט stays only for Ido-Portal-style)
 * Touches live rows too, so eyeball a few after. Safe to re-run. */
function retagDisciplines() {
  var sh = _sheet();
  var idx = _headerIdx(sh);
  var data = sh.getDataRange().getValues();
  var changed = 0, cleared = 0;
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var cur = String(row[idx.category] || '').trim();
    var rule = _disciplineFor(row[idx.title], row[idx.host], idx.venue !== undefined ? row[idx.venue] : '', '');
    if (rule && rule !== cur) { row[idx.category] = rule; changed++; }
    else if (!rule && cur === 'מובמנט') { row[idx.category] = 'אחר'; cleared++; }
  }
  if (changed || cleared) sh.getDataRange().setValues(data);
  Logger.log('retagDisciplines: reassigned ' + changed + ', cleared מובמנט ' + cleared);
  return 'retagDisciplines: reassigned ' + changed + ' rows, cleared ' + cleared + ' from מובמנט → אחר.';
}

/* One-time: re-tag region from the city/venue gazetteer above. Safe to re-run. */
function retagRegions() {
  var sh = _sheet();
  var idx = _headerIdx(sh);
  var data = sh.getDataRange().getValues();
  var changed = 0;
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var newReg = _regionForPlace(row[idx.venue], row[idx.city], row[idx.region]);
    if (newReg && newReg !== row[idx.region]) { row[idx.region] = newReg; changed++; }
  }
  if (changed) sh.getDataRange().setValues(data);
  Logger.log('retagRegions: ' + changed);
  return 'retagRegions: updated ' + changed + ' rows.';
}

/* One-shot: Studio Tamar (סטודיו תמרה) that's the RECHOVOT branch was mis-tagged בת ים.
 * Fix every row whose venue mentions תמרה and city is 'בת ים' (or blank) -> רחובות,
 * and refresh its region. Leaves the Haifa branch (city=חיפה) untouched. Run from the
 * editor; no redeploy. */
function fixStudioTamarCity() {
  var sh = _sheet(), idx = _headerIdx(sh);
  if (idx.venue === undefined || idx.city === undefined) { Logger.log('fixStudioTamarCity: missing venue/city column'); return 0; }
  var data = sh.getDataRange().getValues(), fixed = 0;
  for (var r = 1; r < data.length; r++) {
    var ven = String(data[r][idx.venue] || ''), city = String(data[r][idx.city] || '').trim();
    if (/תמרה/.test(ven) && (city === 'בת ים' || city === '')) {
      data[r][idx.city] = 'רחובות';
      if (idx.region !== undefined) data[r][idx.region] = _regionForPlace(ven, 'רחובות', data[r][idx.region]);
      fixed++;
    }
  }
  if (fixed) sh.getDataRange().setValues(data);
  _venueUpsert('סטודיו תמרה', 'רחובות', _regionForPlace('סטודיו תמרה', 'רחובות', ''));  // so future events tag it right
  Logger.log('fixStudioTamarCity: fixed ' + fixed + ' row(s) → רחובות; venue directory updated');
  return 'fixStudioTamarCity: fixed ' + fixed + ' row(s) to רחובות.';
}

/* ============================================================
 *  PLATFORM ADAPTER — "The Events Calendar" (Tribe Events) REST API
 *  Any WordPress site running the plugin serves clean JSON at
 *    https://<domain>/wp-json/tribe/events/v1/events
 *  ONE adapter ingests them all (confirmed on gagapeople.com). Each event arrives
 *  already dated (recurrences come as separate instances) and routes through
 *  _submitEvent → dedup + discipline/region tagging → review queue (approved=FALSE).
 *  A domain without the plugin just 404s and is skipped safely.
 *
 *  testTribe()          — run once, see the log + review the new pending rows
 *  installTribeTrigger()— schedule it daily; removeTribeTrigger() to stop
 * ============================================================ */
var TRIBE_SOURCES = [
  { domain: 'www.gagapeople.com',        type: '' },
  { domain: 'www.choreographers.org.il', type: 'סדנה' }
  // add more WordPress + Events Calendar movement sites here
];
var TRIBE_MAX_PAGES = 10;   // safety cap (~500 events per site)

function testTribe() { return syncTribeEvents(); }

function syncTribeEvents() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var added = 0, perSite = [];
  TRIBE_SOURCES.forEach(function (src) {
    var evs = _tribeFetch(src.domain, today), n = 0;
    evs.forEach(function (raw) {
      var ev = _tribeMap(raw, src);
      if (!ev || !ev.title || !ev.date || ev.date < today) return;   // future, titled only
      _submitEvent(ev, true, 'tribe'); n++;                          // trusted structured feed → publish LIVE
    });
    added += n; perSite.push(src.domain + ': ' + n);
  });
  Logger.log('syncTribeEvents: published ' + added + ' event(s) LIVE\n' + perSite.join('\n'));
  return 'syncTribeEvents: ' + added + ' events published live (' + perSite.join(' · ') + ')';
}

function _tribeFetch(domain, startDate) {
  var out = [], page = 1, pages = 1;
  do {
    var url = 'https://' + domain + '/wp-json/tribe/events/v1/events?per_page=50&page=' + page +
      '&start_date=' + encodeURIComponent(startDate) + '&status=publish';
    var body;
    try {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZuzuBot/1.0)' } });
      if (resp.getResponseCode() >= 400) { Logger.log('tribe ' + domain + ' HTTP ' + resp.getResponseCode() + ' (no plugin? skipping)'); break; }
      body = JSON.parse(resp.getContentText());
    } catch (e) { Logger.log('tribe ' + domain + ' error: ' + e); break; }
    (body.events || []).forEach(function (e) { out.push(e); });
    pages = body.total_pages || 1; page++;
  } while (page <= pages && page <= TRIBE_MAX_PAGES);
  return out;
}

function _tribeMap(e, src) {
  var sd = e.start_date_details || {}, ed = e.end_date_details || {};
  function pad(x) { return ('0' + (x == null ? '' : x)).slice(-2); }
  var date = (sd.year && sd.month && sd.day) ? (sd.year + '-' + pad(sd.month) + '-' + pad(sd.day))
    : _d(e.start_date).slice(0, 10);
  var time = (sd.hour != null && sd.hour !== '') ? (pad(sd.hour) + ':' + pad(sd.minutes)) : '';
  var timeEnd = '';
  if (ed.year && ed.month && ed.day && (ed.year + '-' + pad(ed.month) + '-' + pad(ed.day)) === date && ed.hour != null && ed.hour !== '')
    timeEnd = pad(ed.hour) + ':' + pad(ed.minutes);
  var v = e.venue || {};
  var title = _tribeDecode(e.title || '');
  var venueName = _tribeDecode(v.venue || v.name || '');
  var org = (e.organizer && e.organizer.length) ? _tribeDecode(e.organizer[0].organizer || '') : '';
  if (!org) org = _hostFromTitle(title, venueName);   // Gaga etc. put the teacher in the title, not the organizer field
  var cat = (e.categories && e.categories.length) ? e.categories[0].name : '';
  return {
    title: title,
    date: date, time: time, time_end: timeEnd,
    venue: venueName, city: v.city || '', host: org,
    url: e.url || '', price: (e.cost || '').toString().trim(),
    category: cat, type: src.type || ''
  };
}

/** Best-effort teacher from a title like "שיעור גאגא עם אוהד נהרין בסוזן דלל" -> "אוהד נהרין".
 *  Text after "עם" up to a delimiter, then cut where the VENUE name appears (so "בסוזן דלל"
 *  is dropped but real names like "רקדני בת שבע" survive). Review-gated, so imperfect is fine. */
function _hostFromTitle(t, venue) {
  var m = String(t || '').match(/(?:^|\s)עם\s+([^,|@\-–—]+)/);
  if (!m) return '';
  var cand = m[1].replace(/\s+/g, ' ').trim(), lc = cand.toLowerCase();
  var vwords = String(venue || '').toLowerCase().replace(/[^0-9a-zא-ת ]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3; });
  for (var i = 0; i < vwords.length; i++) {
    var idx = lc.indexOf(vwords[i]);
    if (idx > 0) { var cut = cand.slice(0, idx).replace(/\s*ב?\s*$/, '').trim(); if (cut) return cut; }
  }
  return cand;
}

function _tribeDecode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); })
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function installTribeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncTribeEvents') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTribeEvents').timeBased().everyDays(1).atHour(5).create();
  Logger.log('syncTribeEvents scheduled daily ~05:00. Undo with removeTribeTrigger().');
}
function removeTribeTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncTribeEvents') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('removed ' + n + ' tribe trigger(s)');
}

/* ============================================================
 *  ECSTATIC DANCE ISRAEL — per-venue weekly sync
 *  ecstaticdance.co.il lists the recurring ecstatic events per venue page.
 *  This fetches each venue URL (UrlFetchApp — not blocked like a browser fetch),
 *  extracts events with the shared _extractEventsFromUrl (JSON-LD + text + Claude),
 *  defaults their discipline to אקסטטיק, and routes each through _submitEvent
 *  (approved=FALSE → review). Runs itself every Sunday morning.
 *
 *  testEcstatic()            — run once, check the log + the review queue
 *  installEcstaticTrigger()  — schedule it every Sunday ~07:00; remove with removeEcstaticTrigger()
 *  Edit ECSTATIC_VENUE_URLS to add/remove venues.
 * ============================================================ */
var ECSTATIC_AUTO_APPROVE = true;   // ecstatic events go straight live (behind a basic quality gate). Set false to send them to review instead.
var ECSTATIC_VENUE_URLS = [
  'https://ecstaticdance.co.il/venue/jerusalem/',
  'https://ecstaticdance.co.il/venue/%d7%97%d7%99%d7%a4%d7%94/',                                   // חיפה
  'https://ecstaticdance.co.il/venue/%d7%9e%d7%95%d7%93%d7%99%d7%a2%d7%99%d7%9f/',                 // מודיעין
  'https://ecstaticdance.co.il/venue/being/',
  'https://ecstaticdance.co.il/venue/%d7%91%d7%99%d7%aa-%d7%9c%d7%97%d7%9d-%d7%94%d7%92%d7%9c%d7%9c%d7%99%d7%aa/', // בית לחם הגלילית
  'https://ecstaticdance.co.il/venue/%d7%97%d7%95%d7%a3-%d7%9b%d7%a8%d7%9e%d7%9c/',                 // חוף כרמל
  'https://ecstaticdance.co.il/venue/%d7%aa%d7%9c-%d7%90%d7%91%d7%99%d7%91/',                       // תל אביב
  'https://ecstaticdance.co.il/venue/%d7%a2%d7%9e%d7%a7-%d7%97%d7%a4%d7%a8/',                       // עמק חפר
  'https://ecstaticdance.co.il/venue/%d7%94%d7%a9%d7%a8%d7%95%d7%9f/'                               // השרון
];

function testEcstatic() { return syncEcstatic(); }

function syncEcstatic() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var added = 0, perSite = [];
  ECSTATIC_VENUE_URLS.forEach(function (url) {
    try {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZuzuBot/1.0)' } });
      if (resp.getResponseCode() >= 400) { perSite.push(url + ' HTTP ' + resp.getResponseCode()); return; }
      var html = resp.getContentText();
      var ld = _extractJsonLd(html), text = _htmlToText(html).slice(0, 12000), links = _harvestLinks(html);
      var r = _extractEventsFromUrl(text, ld, links, url);
      if (!r || r.error) { perSite.push(url + ' — ' + ((r && r.error) || 'extract failed')); return; }
      var n = 0, live = 0;
      (r.events || []).forEach(function (ev) {
        if (!ev.title || !ev.date || ev.date < today) return;   // future, titled only
        if (!ev.category) ev.category = 'אקסטטיק';               // default discipline for this source
        if (!ev.url) ev.url = url;
        // quality gate: only a complete event (title + date + venue) may auto-publish
        var approve = ECSTATIC_AUTO_APPROVE && !!(ev.title && ev.date && ev.venue);
        _submitEvent(ev, approve, 'ecstatic'); n++; if (approve) live++;
      });
      added += n; perSite.push(url.split('/venue/')[1] + ': ' + n + (ECSTATIC_AUTO_APPROVE ? ' (' + live + ' live)' : ''));
    } catch (e) { perSite.push(url + ' error: ' + e); }
  });
  Logger.log('syncEcstatic: ' + added + ' event(s) to review\n' + perSite.join('\n'));
  return 'syncEcstatic: ' + added + ' events to review';
}

function installEcstaticTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncEcstatic') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncEcstatic').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  Logger.log('syncEcstatic scheduled every Sunday ~07:00. Undo with removeEcstaticTrigger().');
}
function removeEcstaticTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncEcstatic') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('removed ' + n + ' ecstatic trigger(s)');
}

/* ============================================================
 *  STUDIO MAOZ HA'YAM (סטודיו מעוז הים, שדות ים) — weekly dance/movement classes
 *  from the studio's weekly timetable. Each is inserted as a repeat=weekly row
 *  (so it never expires) into REVIEW (approved=FALSE) — bulk-approve once.
 *  Edit the `slots` list and re-run to update. Yoga/Pilates/kids/youth omitted.
 * ============================================================ */
function _nextWeekdayIso(dow) {   // dow: 0=Sun … 6=Sat  → next date on/after today on that weekday
  var d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function setupMaozHaYam() {
  var V = 'סטודיו מעוז הים', C = 'שדות ים', R = 'פרדס חנה והסביבה';
  var slots = [
    // [weekday 0=Sun..5=Fri, time, title, host, category, type]
    [2, '20:30', 'ריקוד חופשי', 'עמרי קליינברגר', 'ריקוד חופשי', ''],       // שלישי
    [4, '20:30', 'ריקוד חופשי', 'עמרי קליינברגר', 'ריקוד חופשי', ''],       // חמישי
    [1, '20:30', 'ריקוד הלב הפתוח', 'מיכל חלפן', 'ריקוד חופשי', ''],        // שני
    [4, '18:00', 'אימפרוביזציה', 'רוני מגדל', 'אימפרוביזציה', ''],          // חמישי (שעה לאימות)
    [2, '16:30', 'מחול נפש', 'עינת ייב אסטלין', 'מחול', ''],                // שלישי
    [0, '19:30', 'ג׳אז לירי', 'דפנה גרבינסקי', 'מחול', ''],                 // ראשון
    [2, '10:00', 'סדנת מורים · אורלי פורטל', 'אורלי פורטל', 'מחול', 'סדנה'] // שלישי
  ];
  var n = 0;
  slots.forEach(function (s) {
    _submitEvent({ date: _nextWeekdayIso(s[0]), time: s[1], title: s[2], host: s[3],
      category: s[4], type: s[5], venue: V, city: C, region: R, repeat: 'weekly' }, true, 'maozhayam');
    n++;
  });
  Logger.log('setupMaozHaYam: ' + n + ' weekly classes → LIVE');
  return 'setupMaozHaYam: ' + n + ' weekly classes published live';
}

/* Movement by Yaniv Tzadick — every Sunday at Silo (הוד השרון). Weekly recurring,
 * אקסטטיק → auto-tagged מסיבה. Confirm the time (defaulted to 20:30). */
function setupYanivTzadick() {
  _submitEvent({ date: _nextWeekdayIso(0), time: '20:30',
    title: 'Movement by Yaniv Tzadick — אקסטטיק דאנס בחושך', host: 'יניב צדיק',
    category: 'אקסטטיק', venue: 'סילו תרבות', city: 'הוד השרון', region: 'שרון',
    url: 'https://www.move-ment.co.il/', repeat: 'weekly' }, true, 'weekly-slot');
  Logger.log('setupYanivTzadick: Sunday slot at Silo → LIVE');
  return 'Yaniv Tzadick — Sunday at Silo published live (confirm the time)';
}

/* Delete every row for a given source (bottom-up, so row indices stay valid).
 * Used by the monthly Suzanne-Dellal refresh so a re-run replaces cleanly
 * (no duplicate weekly series, and teacher rotations actually update). */
function _deleteBySource(src) {
  var sh = _sheet(), col = _headerIdx(sh), sc = col['source'];
  if (sc === undefined) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(1, sc + 1, last, 1).getValues(), n = 0;
  for (var r = last; r >= 2; r--) {
    if (String(vals[r - 1][0]).trim() === src) { sh.deleteRow(r); n++; }
  }
  return n;
}

/* ============================================================
 *  GAGA @ SUZANNE DELLAL (סוזן דלל, תל אביב) — full weekly grid.
 *  The class TIMETABLE is roughly stable; the teacher rotates each date.
 *  Stored as repeat=weekly rows (never expire) + a per-date `teachers`
 *  rotation. MONTHLY UPDATE: paste the new Gaga timetable to Claude, get a
 *  fresh copy of this function, and re-run it — it deletes the old
 *  Suzanne-Dellal rows first, so teachers/times refresh with no duplicates.
 *  Evening times use the ongoing (Sep) pattern; a teacher name not listed
 *  for a date shows "המורה יתעדכן". Rotation covers 30.8–2.10.
 * ============================================================ */
function setupSuzanneDellalGaga() {
  var V = 'מרכז סוזן דלל', C = 'תל אביב', R = 'תל אביב';
  var U = 'https://www.gagapeople.com/גאגא-בסוזן-דלל-2/';
  var W = 'שיעור גאגא — סוזן דלל';                 // regular open Gaga class
  var WEL = 'Gaga Welcome — שיעור פתוח למתחילים (סוזן דלל)'; // 75-min beginner class
  // [weekday 0=Sun..5=Fri, time_start, time_end, title, teachers-by-date]
  var slots = [
    [0, '08:30', '09:30', W,   '30.8=Adrienne Lipson; 6.9=Stefan Ferry; 20.9=Adi Zlatin; 27.9=Alma Karvet Shemesh'],
    [0, '18:30', '19:30', W,   '30.8=Yaara Moses; 6.9=Yaara Moses; 27.9=Yael Schnell'],
    [1, '08:30', '09:30', W,   '31.8=Adi Zlatin; 7.9=Beatrice Larivee; 14.9=Hillel Kogan; 28.9=Hsin-Yi Hsiang'],
    [1, '18:30', '19:30', W,   '31.8=Yankalle Filtser; 7.9=Hillel Kogan; 14.9=Korina Fraiman; 28.9=Avigail Shafrir'],
    [1, '20:45', '21:45', W,   '31.8=Chen Agron; 7.9=Yoni Simon; 14.9=Adrienne Lipson; 28.9=Ohad Fishof'],
    [2, '08:30', '09:30', W,   '1.9=Noa Zuk; 8.9=Adi Zlatin; 15.9=Saar Harari; 22.9=Matan David; 29.9=Beatrice Larivee'],
    [2, '19:45', '21:00', WEL, '1.9=Beatrice Larivee; 8.9=Londiwe Khoza; 15.9=Yankalle Filtser; 22.9=Saar Harari; 29.9=Saar Harari'],
    [3, '08:30', '09:30', W,   '2.9=Hillel Kogan; 9.9=Hillel Kogan; 16.9=Hsin-Yi Hsiang; 23.9=Hillel Kogan; 30.9=Erez Zohar'],
    [3, '18:30', '19:30', W,   '2.9=Aya Israeli; 9.9=Kornelia Lech; 16.9=Aya Israeli; 23.9=Yankalle Filtser; 30.9=Tom Nissim'],
    [3, '20:45', '21:45', W,   '2.9=Korina Fraiman; 9.9=Yael Schnell; 16.9=Tom Nissim; 23.9=Danai Porat; 30.9=Maayan Sheinfeld'],
    [4, '08:30', '09:30', W,   '3.9=Roni Milatin; 10.9=Ohad Fishof; 17.9=Lee Sher; 24.9=Ohad Fishof'],
    [4, '10:00', '11:00', W,   '3.9=Yael Schnell; 10.9=Shani Garfinkel; 17.9=Adi Zlatin; 24.9=Yael Schnell'],
    [4, '18:30', '19:30', W,   '3.9=Alma Karvet Shemesh; 10.9=Lee Sher; 17.9=Avigail Shafrir; 24.9=Yoni Simon'],
    [5, '08:30', '09:30', W,   '4.9=Hillel Kogan; 11.9=Saar Harari; 18.9=Saar Harari; 25.9=Adi Zlatin'],
    [5, '10:00', '11:00', W,   '4.9=Noa Zuk; 11.9=Hsin-Yi Hsiang; 18.9=Hillel Kogan; 25.9=Saar Harari']
  ];
  var removed = _deleteBySource('suzanne-gaga');   // clean slate → monthly refresh, no dupes
  var n = 0;
  slots.forEach(function (s) {
    _submitEvent({ date: _nextWeekdayIso(s[0]), time: s[1], time_end: s[2],
      title: s[3], host: '', category: 'גאגא', type: 'שיעור', teachers: s[4],
      venue: V, city: C, region: R, url: U, repeat: 'weekly' }, true, 'suzanne-gaga');
    n++;
  });
  Logger.log('setupSuzanneDellalGaga: removed ' + removed + ', added ' + n + ' weekly Gaga slots → LIVE');
  return 'setupSuzanneDellalGaga: replaced ' + removed + ' old rows with ' + n + ' weekly Gaga slots (teachers filled)';
}

/* One-shot: set every existing אקסטטיק row's type to מסיבה (fixing ג'אם / שיעור /
 * מסיבת ריקוד / blank). Leaves genuine סדנה/קורס/ריטריט/מופע as-is. Run once. */
function retagEcstaticType() {
  var sh = _sheet(); _ensureCol(sh, 'type'); var idx = _headerIdx(sh);
  if (idx.category === undefined || idx.type === undefined) return 'missing category/type column';
  var data = sh.getDataRange().getValues(), keep = ['סדנה', 'קורס', 'ריטריט', 'אינטנסיב', 'מופע', 'מאסטר-קלאס'], fixed = 0;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][idx.category] || '').indexOf('אקסטטיק') < 0) continue;
    var t = String(data[r][idx.type] || '').trim();
    if (keep.indexOf(t) < 0 && t !== 'מסיבה') { data[r][idx.type] = 'מסיבה'; fixed++; }
  }
  if (fixed) sh.getDataRange().setValues(data);
  Logger.log('retagEcstaticType: ' + fixed + ' row(s) → מסיבה');
  return 'retagEcstaticType: set ' + fixed + ' אקסטטיק rows to מסיבה';
}

/* Clickable-link fallback for working directly in the sheet.
 * Adds a 'link' column of per-row =HYPERLINK() so every url is one click.
 * Per-row (not ARRAYFORMULA) so appendRow from the pipeline can't blow up the spill.
 * Idempotent — re-run after a big import to fill new rows. */
function addLinkColumn() {
  var sh = _sheet();
  var idx = _headerIdx(sh);
  if (idx.url === undefined) return 'no url column found';
  var linkCol = _ensureCol(sh, 'link');
  var n = sh.getLastRow();
  if (n < 2) return 'no data rows';
  var urlL = _colLetter(idx.url + 1), f = [];
  for (var r = 2; r <= n; r++) f.push(['=IF(' + urlL + r + '="","",HYPERLINK(' + urlL + r + ',"↗ פתח"))']);
  sh.getRange(2, linkCol + 1, f.length, 1).setFormulas(f);
  return 'link column ready (' + f.length + ' rows). Re-run after a big import.';
}
function _colLetter(col) { var s = ''; while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - m - 1) / 26); } return s; }

/* ============================================================
 *  STEP 3 — insert-or-merge (cross-source dedup) + date_end/type
 * ============================================================ */

/** Header name -> column index, tolerant of stray spaces in header cells. */
function _headerIdx(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {}; h.forEach(function (name, i) { idx[String(name).trim()] = i; });
  return idx;
}

/** Dedup key = normalised date + TITLE + VENUE (see file header for the why).
 *  Keyed on the EVENT, not the sender, so scrape+newsletter duplicates collapse —
 *  but only when they are really the same event, so the merge never eats a
 *  distinct one. */
function _evKey(o) {
  var dv = o.date;
  // dates read back from the sheet may be Date objects (esp. if a Table date-formatted
  // the column) — normalise to yyyy-MM-dd so a Date and a "2026-07-23" string match.
  var d = (dv instanceof Date)
    ? Utilities.formatDate(dv, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : String(dv || '').trim();
  var m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);          // a few rows use M/D/Y — normalise to ISO
  if (m) d = m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  var t = String(o.title || '')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(parseInt(n, 10)); })  // Rav-Masser Hebrew entities
    .replace(/[—\-–]\s*\d{1,2}[.\/]\d{1,2}\s*$/, '')          // drop a trailing "— 27.7"
    .toLowerCase().replace(/[^\wא-ת]+/g, ' ').replace(/\s+/g, ' ').trim();
  var v = String(o.venue || '').replace(/\s+/g, '').toLowerCase();
  return d + '|' + t + '|' + v;
}

/** Row (1-based) whose date|title|venue matches key, or -1. */
function _rowIndexByKey(sh, key) {
  var n = sh.getLastRow();
  if (n < 2) return -1;
  var vals = sh.getDataRange().getValues(), idx = _headerIdx(sh);
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    if (_evKey({ date: row[idx.date], title: row[idx.title], venue: row[idx.venue] }) === key) return r + 1;
  }
  return -1;
}

/* ============================================================
 *  DUPLICATE CLEANUP — same event listed twice from different sources
 *  The exact date|title|venue key misses near-duplicates whose title/venue text
 *  differs (e.g. "ג'אם קונטקט…" vs "מעבר לגוף – ג'אם קונטקט…"). But two events by
 *  the SAME teacher at the SAME time on the SAME day are the same event — a teacher
 *  can't be in two places at once — so date+time+teacher is a safe near-dup key.
 *
 *  Run previewDuplicates() first (writes nothing — logs what it WOULD remove),
 *  then dedupeApprovedByHostDateTime() to apply. Keeps the most complete row and
 *  UNPUBLISHES the rest (approved=FALSE + review='rejected') — reversible in the
 *  reviewer via "↩ החזר לבדיקה", NOT a hard delete. Run from the editor; no redeploy.
 * ============================================================ */
function previewDuplicates() { return dedupeApprovedByHostDateTime(true); }

function dedupeApprovedByHostDateTime(dryRun) {
  var sh = _sheet();
  _ensureCol(sh, 'review'); _ensureCol(sh, 'reason');
  var idx = _headerIdx(sh);
  if (idx.approved === undefined || idx.host === undefined || idx.date === undefined || idx.time === undefined) {
    Logger.log('dedupe: missing a required column (approved/host/date/time)'); return 0;
  }
  var vals = sh.getDataRange().getValues(), groups = {};
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    if (row[idx.approved] !== true) continue;                 // only live (published) events
    var host = _hostFirstToken(row[idx.host]), time = _normTime24(row[idx.time]), date = _d(row[idx.date]);
    if (host.length < 2 || !date) continue;                   // need at least performer + day
    var key;
    if (time) {
      key = date + '|' + time + '|' + host;                   // same performer, same day, same time
    } else {                                                  // timeless rows: same performer + day + discipline = same event
      var cat = idx.category !== undefined ? String(row[idx.category] || '').split(',')[0].trim().toLowerCase() : '';
      key = date + '|NOTIME|' + host + '|' + cat;
    }
    (groups[key] = groups[key] || []).push({ row: r + 1, score: _completeness(row, idx), title: String(row[idx.title] || '') });
  }
  var removed = 0, log = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k];
    if (g.length < 2) return;
    g.sort(function (a, b) { return b.score - a.score || a.row - b.row; });   // keep the most complete, then earliest
    for (var i = 1; i < g.length; i++) {
      if (!dryRun) {
        sh.getRange(g[i].row, idx.approved + 1).setValue(false);
        if (idx.review !== undefined) sh.getRange(g[i].row, idx.review + 1).setValue('rejected');
        if (idx.reason !== undefined) sh.getRange(g[i].row, idx.reason + 1).setValue('כפילות — ניקוי אוטומטי (יום+שעה+מנחה)');
      }
      removed++;
      log.push((dryRun ? '[would remove] ' : '[removed] ') + '“' + g[i].title + '”  → keep “' + g[0].title + '”  (' + k + ')');
    }
  });
  Logger.log('dedupeApprovedByHostDateTime' + (dryRun ? ' (PREVIEW — nothing changed)' : '') +
    ': ' + removed + ' duplicate row(s)\n' + (log.join('\n') || '(none found)'));
  return removed;
}

/** Make the dedupe run BY ITSELF — once a day around 04:00, hands-off.
 *  Run this ONCE from the editor. Reversible cleanup (unpublish, not delete).
 *  Turn it back off anytime with removeDedupeTrigger(). No redeploy needed. */
function installDedupeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dedupeApprovedByHostDateTime') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dedupeApprovedByHostDateTime').timeBased().everyDays(1).atHour(4).create();
  Logger.log('Dedupe will now run automatically every day ~04:00. Undo with removeDedupeTrigger().');
}
function removeDedupeTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dedupeApprovedByHostDateTime') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('removed ' + n + ' dedupe trigger(s)');
}

/** First name-token of a host, for matching same-teacher rows.
 *  "עם עמית שמואלי, ועילי עוזר" -> "עמית". Drops a leading "עם". */
function _hostFirstToken(h) {
  h = String(h || '').replace(/[.,()\/\-–—]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^עם\s+/, '');
  return (h.split(' ')[0] || '').toLowerCase();
}

/** How many content fields a row fills — used to keep the richer of two duplicates. */
function _completeness(row, idx) {
  var n = 0;
  ['url', 'phone', 'category', 'type', 'venue', 'city', 'region', 'time_end', 'price', 'host', 'title'].forEach(function (f) {
    if (idx[f] !== undefined && String(row[idx[f]] == null ? '' : row[idx[f]]).trim()) n++;
  });
  return n;
}

/**
 * Insert OR merge one event into the events sheet.
 *   - new key      -> append a fresh row (approved defaults to `approved`).
 *   - existing key -> MERGE: fill only BLANK cells in the existing row
 *                     (richest-field-wins), never downgrades approved, never
 *                     overwrites a human edit. Returns {status, row}.
 */
/* ============================================================
 *  EVENTS ON HIATUS — hide matching events from the LIVE site until `until`
 *  (inclusive). Matched on title+host. A feed can keep re-adding them, but they
 *  stay off the site while suppressed; once the date passes they publish again.
 *  Add an entry per group on break; edit `until` when they're back.
 * ============================================================ */
var SUPPRESSED = [
  // מעבר לגוף — ג'אם קונטקט (עמית שמואלי / עילי עוזר). On break. ⚠ confirm return date.
  { match: /מעבר לגוף|עמית שמואלי|עילי עוזר/i, until: '2026-09-30' }
];
function _isSuppressed(o) {
  var hay = [o.title, o.host].filter(Boolean).join(' ');
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  for (var i = 0; i < SUPPRESSED.length; i++) {
    if (SUPPRESSED[i].match.test(hay) && today <= String(SUPPRESSED[i].until)) return true;
  }
  return false;
}
/* One-shot: unpublish any currently-live rows that match an active suppression. */
function applySuppressions() {
  var sh = _sheet(); _ensureCol(sh, 'review'); _ensureCol(sh, 'reason');
  var col = _headerIdx(sh), last = sh.getLastRow(); if (last < 2) return 'empty';
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues(), n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][col.approved] !== true) continue;
    if (_isSuppressed({ title: vals[i][col.title], host: vals[i][col.host] })) {
      sh.getRange(i + 2, col.approved + 1).setValue(false);
      if (col.review !== undefined) sh.getRange(i + 2, col.review + 1).setValue('rejected');
      if (col.reason !== undefined) sh.getRange(i + 2, col.reason + 1).setValue('בהפסקה — הוסתר זמנית');
      n++;
    }
  }
  Logger.log('applySuppressions: hid ' + n);
  return 'applySuppressions: hid ' + n + ' row(s) on hiatus';
}

/* ONE-CLICK CLEANUP — run this whenever the queue gets messy. Order matters:
 * normalise times first (so dedupe can match), drop the hand-added feed dupes,
 * hide events on hiatus, then collapse remaining same host+date+time duplicates. */
function cleanupZuzu() {
  var out = [];
  out.push(normalizeTimes());
  out.push(removeIrisNiceEvents());
  out.push(removeMakatzveiHalev());
  out.push(applySuppressions());
  out.push('dedupe: ' + dedupeApprovedByHostDateTime() + ' removed');
  var msg = 'cleanupZuzu →\n  ' + out.join('\n  ');
  Logger.log(msg);
  return msg;
}

function _submitEvent(data, approved, source) {
  var sh = _sheet();
  _ensureCol(sh, 'time_end'); _ensureCol(sh, 'date_end'); _ensureCol(sh, 'type'); _ensureCol(sh, 'phone'); _ensureCol(sh, 'repeat'); _ensureCol(sh, 'dates'); _ensureCol(sh, 'count'); _ensureCol(sh, 'teachers');
  var uidCol = _ensureCol(sh, 'uid'), srcCol = _ensureCol(sh, 'source'), lvCol = _ensureCol(sh, 'last_verified');
  var col = _headerIdx(sh);
  var _now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');  // freshness stamp

  var incoming = {
    date: data.date || '', time: _normTime24(data.time), time_end: _normTime24(data.time_end),
    title: (data.title || '').toString().slice(0, 200),
    host: (data.host || '').toString().slice(0, 120),
    category: _disciplineFor(data.title, data.host, data.venue, data.category || data.discipline || ''),
    venue: (data.venue || '').toString().slice(0, 160),
    city: data.city || '', region: _regionForPlace(data.venue, data.city, data.region || ''),
    url: data.url || '', price: data.price || '',
    phone: (data.phone || '').toString().slice(0, 40),
    date_end: data.date_end || '', type: data.type || '',
    repeat: (data.repeat || '').toString().trim(),
    dates: (data.dates || '').toString().trim(),
    count: (data.count || '').toString().trim(),
    teachers: (data.teachers || '').toString().trim()
  };
  // MASTER DIRECTORY (Google Sheet): canonicalize name spellings, auto-fill contact/
  // location, and tag known Gaga teachers as גאגא. Authoritative — runs first.
  _applyDirectory(incoming);
  if (_isSuppressed(incoming)) approved = false;   // event on hiatus → keep it off the live site
  // Ecstatic dance is always a PARTY (מסיבה), never a jam. Force the type for
  // אקסטטיק — except genuine multi-session / show formats, which stay as they are.
  if (String(incoming.category || '').indexOf('אקסטטיק') >= 0) {
    var _keepFmt = ['סדנה', 'קורס', 'ריטריט', 'אינטנסיב', 'מופע', 'מאסטר-קלאס'];
    if (_keepFmt.indexOf(String(incoming.type || '').trim()) < 0) incoming.type = 'מסיבה';
  }
  // Venue directory: learn venue -> city/region, and fill a missing city/region from it.
  if (incoming.venue) {
    _venueUpsert(incoming.venue, incoming.city, incoming.region);
    var _vc = _venueMap()[_venueKey(incoming.venue)];
    if (_vc) {
      if (!incoming.city && _vc.city) incoming.city = _vc.city;
      if (!incoming.region && _vc.region) incoming.region = _vc.region;
    }
    if (!incoming.city) {                        // known fixed venues (Suzanne Dellal…) -> city
      var _hc = _cityForVenue(incoming.venue);
      if (_hc) { incoming.city = _hc; incoming.region = _regionForPlace(incoming.venue, incoming.city, incoming.region); }
    }
  }
  // Teacher directory: learn this teacher's contact if the event carries one, then
  // fill a missing url/phone from what we already know about that teacher.
  if (incoming.host) {
    _teacherUpsert(incoming.host, incoming.phone, incoming.url);
    var _tc = _teacherMap()[_teacherKey(incoming.host)];
    if (_tc) {
      if ((!incoming.url || incoming.url === '#') && _tc.url) incoming.url = _tc.url;
      if (!incoming.phone && _tc.phone) incoming.phone = _tc.phone;
    }
  }
  // Known recurring source -> canonical url + phone (fills only empty / "#")
  var _sp = _sourceProfile(incoming.title, incoming.host, incoming.venue);
  if (_sp) {
    if ((!incoming.url || incoming.url === '#') && _sp.url) incoming.url = _sp.url;
    if (!incoming.phone && _sp.phone) incoming.phone = _sp.phone;
  }
  var key = _evKey(incoming), existing = _rowIndexByKey(sh, key);

  if (existing > 0) {
    var cur = sh.getRange(existing, 1, 1, sh.getLastColumn()).getValues()[0], changed = false;
    Object.keys(incoming).forEach(function (f) {
      if (col[f] === undefined) return;
      if ((cur[col[f]] === '' || cur[col[f]] === null) && incoming[f] !== '') { cur[col[f]] = incoming[f]; changed = true; }
    });
    if (!String(cur[uidCol] == null ? '' : cur[uidCol]).trim()) {     // an old/merged row may lack a uid — give it one
      cur[uidCol] = Utilities.getUuid().replace(/-/g, '').slice(0, 10); changed = true;
    }
    if (lvCol !== undefined) { cur[lvCol] = _now; changed = true; }   // seen again today = still live
    if (changed) sh.getRange(existing, 1, 1, cur.length).setValues([cur]);
    _mirrorToSupabase(incoming, approved, source, cur[uidCol]);
    return { status: 'merged', row: existing, uid: cur[uidCol] };
  }

  var row = [];
  for (var i = 0; i < sh.getLastColumn(); i++) row.push('');
  row[col.timestamp] = new Date();
  row[col.approved] = approved === true;
  Object.keys(incoming).forEach(function (f) { if (col[f] !== undefined) row[col[f]] = incoming[f]; });
  var newUid = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  row[uidCol] = newUid;
  row[srcCol] = source || 'submit';
  row[lvCol] = _now;
  sh.appendRow(row);
  _mirrorToSupabase(incoming, approved, source, newUid);
  return { status: 'inserted', row: sh.getLastRow(), uid: newUid };
}

/* ============================================================
 *  SUPABASE MIRROR (zuzu v2)
 *  Every event that reaches the sheet (Tribe, ecstatic, bodyways, newsletters,
 *  the site form, screenshots...) is also queued in Supabase table
 *  event_submissions, so nothing is lost after the site switches to Supabase.
 *  It is a REVIEW QUEUE: nothing goes live from here automatically.
 *  - Uses the public anon key (insert-only on that table; it cannot read or publish).
 *  - One queue row per sheet uid: a repeat send is rejected by a unique index.
 *  - Never breaks the sheet flow: errors are only logged.
 *  Turn off with SUPABASE_MIRROR = false.
 * ============================================================ */
var SUPABASE_MIRROR = true;
var SUPABASE_URL = 'https://eiseowpkwexktqrtoeaq.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpc2Vvd3Brd2V4a3RxcnRvZWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MTQwMjEsImV4cCI6MjEwNTk5MDAyMX0.sVsFmBZUWwfvRL_pt3SMgkggy_GNCRKrWGdzHpg0qHg'; // public by design

function _mirrorToSupabase(incoming, approved, source, uid) {
  if (!SUPABASE_MIRROR || !uid) return;
  try {
    var payload = {};
    Object.keys(incoming).forEach(function (k) { payload[k] = incoming[k]; });
    payload.uid = String(uid);
    payload.source = source || 'submit';
    payload.approved_in_sheet = approved === true;
    payload.mirrored_at = new Date().toISOString();
    var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/event_submissions', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, Prefer: 'return=minimal' },
      payload: JSON.stringify({ payload: payload }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code >= 300 && code !== 409) Logger.log('supabase mirror ' + code + ': ' + resp.getContentText().slice(0, 200));
  } catch (e) { Logger.log('supabase mirror error: ' + e); }
}

/* Run once from the editor after deploying: sends one test row, then check it in Supabase. */
function testSupabaseMirror() {
  _mirrorToSupabase({ title: 'בדיקת חיבור — אפשר למחוק', date: '' }, false, 'test', 'test-' + Date.now());
  return 'sent — check event_submissions in Supabase (source = test)';
}

/** Screenshot → events, using Claude vision. */
/* DIAGNOSTIC: pings the Anthropic API with your ANTHROPIC_API_KEY and logs the exact
 * raw response, so you can see precisely what's wrong (credit / key / spend-limit).
 * Run from the editor and read the Execution log. */
function pingAnthropic() {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) { Logger.log('❌ No ANTHROPIC_API_KEY set in Script Properties.'); return 'no key'; }
  Logger.log('Key present — starts "' + key.slice(0, 14) + '…", length ' + key.length);
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  Logger.log('HTTP ' + code + (code === 200 ? '  ✅ the key works and has usable credit' : '  ❌ see the raw error below'));
  Logger.log(resp.getContentText().slice(0, 600));
  return 'HTTP ' + code + ' — read the Execution log for the exact Anthropic message';
}

function _scan(data) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { events: [], error: 'מפתח ה-AI לא הוגדר. ⚙ Project Settings ▸ Script Properties ▸ הוסיפי ANTHROPIC_API_KEY.' };

  var b64 = (data.image || '').replace(/^data:[^,]+,/, '');
  var mime = data.mime || 'image/png';
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var prompt =
    "אתה מחלץ אירועי ריקוד/תנועה מצילום מסך, פלייר, או קובץ PDF (בעברית — לרוב הודעה מקבוצת וואטסאפ או עמוד סדנאות).\n" +
    "החזר אך ורק מערך JSON תקין, בלי טקסט נוסף. כל פריט:\n" +
    '{"date":"YYYY-MM-DD","time":"HH:mm","time_end":"HH:mm שעת סיום או \\"\\"","title":"...","host":"שם המנחה או \\"\\"",' +
    '"category":"תחום התנועה","type":"סוג האירוע","venue":"שם המקום","city":"עיר או \\"\\"","region":"אזור",' +
    '"price":"מחיר או \\"\\"","url":"קישור אם מופיע או \\"\\"","phone":"מספר טלפון/וואטסאפ אם מופיע או \\"\\"",' +
    '"repeat":"weekly|biweekly|monthly אם חוזר, אחרת \\"\\"","dates":"רשימת תאריכים אם יש כמה מפגשים למשל 1.9, 15.9, 29.9 אחרת \\"\\"","date_end":"YYYY-MM-DD תאריך סיום סדרה/קורס או \\"\\"","count":"מספר מפגשים אם צוין אחרת \\"\\""}\n' +
    "category = תחום התנועה (הסגנון). אפשרויות: " + CATEGORIES + ".\n" +
    "type = סוג/פורמט האירוע. אפשרויות: " + TYPES + ".\n" +
    "שים לב: 'ג'אם' ו'סדנה' הם סוג (type) ולא תחום (category). למשל 'ג'אם קונטקט' => category=קונטקט, type=ג'אם.\n" +
    "phone = אם אין קישור להרשמה אבל מופיע מספר טלפון או וואטסאפ ליצירת קשר — החזר אותו (ספרות בלבד). אחרת \"\".\n" +
    "time_end = שעת הסיום אם מצוינת (\"עד 21:00\", \"19:00-21:00\", \"שעתיים\"). אחרת \"\".\n" +
    "חזרתיות ותאריכים — חשוב: אם זה קורס/סדרה עם כמה מפגשים, החזר:\n" +
    "  • repeat = weekly (שבועי) / biweekly (דו-שבועי) / monthly (חודשי) אם הקצב קבוע (\"כל שבוע\", \"כל יום ראשון\", \"אחת לשבועיים\"). date = תאריך המפגש הראשון.\n" +
    "  • dates = רשימת התאריכים המדויקת אם הם מפורטים ולא בקצב קבוע (למשל \"1.9, 15.9, 29.9\").\n" +
    "  • count = מספר המפגשים אם צוין (\"6 מפגשים\", \"סדרה של 8\"). date_end = תאריך המפגש האחרון אם צוין.\n" +
    "  • אירוע חד-פעמי (סדנה/ג'אם/מופע בודד) => repeat=\"\", dates=\"\", count=\"\".\n" +
    "אזורים אפשריים: " + REGIONS + " (בחר את הקרוב ביותר לפי העיר).\n" +
    "התאריך היום הוא " + today + ". אם מופיע יום/תאריך בלי שנה, הנח את השנה הקרובה. אם אין שעה, נחש לפי ההקשר או השאר \"\".\n" +
    "חשוב מאוד: הקלט עשוי להכיל כמה אירועים נפרדים (למשל כמה הודעות/פוסטים בזה אחר זה באותו טקסט) — פַצֵּל אותם והחזר כל אירוע כפריט נפרד במערך. אל תמזג כמה אירועים לאחד. אם אין אף אירוע — החזר [].";
  if (data.text) prompt += "\n\nהטקסט הבא הוא מקור עיקרי — חלץ ממנו את כל האירועים (ואם צורפה גם תמונה, השלם ממנו פרטים חסרים):\n" + data.text;

  var content = [];
  if (b64) {
    if (/pdf/i.test(mime)) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    else content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
  }
  content.push({ type: 'text', text: prompt });
  var payload = {
    model: 'claude-sonnet-4-6',   // swap to 'claude-haiku-4-5' for cheaper/faster
    max_tokens: 1800,
    messages: [{ role: 'user', content: content }]
  };

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = JSON.parse(resp.getContentText());
  // surface the real reason if Anthropic rejected the request
  if (code !== 200 || (body && body.type === 'error')) {
    var msg = (body && body.error && body.error.message) || ('HTTP ' + code);
    var hint = msg;
    if (/credit|balance|billing|quota/i.test(msg)) hint = 'אין יתרת קרדיט בחשבון Anthropic — היכנסי ל-console.anthropic.com ▸ Billing והוסיפי קרדיט.';
    else if (code === 401 || /authentication|api[- ]?key|invalid x-api-key/i.test(msg)) hint = 'מפתח ה-API שגוי או לא פעיל — בדקי שהעתקת אותו במלואו (sk-ant-…).';
    else if (code === 429 || /rate/i.test(msg)) hint = 'יותר מדי בקשות בבת אחת — נסי שוב בעוד רגע.';
    return { events: [], error: hint, raw: msg, code: code };
  }

  var text = (body.content && body.content[0] && body.content[0].text) || '';
  var m = text.match(/\[[\s\S]*\]/);
  var events = [];
  if (m) { try { events = JSON.parse(m[0]); } catch (e) {} }
  // normalise empties to nulls the site expects
  events.forEach(function (ev) {
    ['city','price','url','host'].forEach(function (k) { if (ev[k] === '') ev[k] = (k === 'url' ? '#' : null); });
    ev.image = null; ev.recurring = false;
  });
  return { events: events };
}

/* ---------- helpers ---------- */
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function _d(v) { return (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v || ''); }
function _t(v) { return (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm') : String(v || ''); }
/* Force any time entry into 24h HH:MM ("1800"→"18:00", "8"→"08:00", "10pm"→"22:00").
 * Used on ingest + in the dedupe key so "1800" and "18:00" are recognised as equal. */
function _normTime24(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  var s = String(v == null ? '' : v).trim(); if (!s) return '';
  var ap = null, am = s.match(/([ap])\.?\s*m/i); if (am) { ap = am[1].toLowerCase(); s = s.replace(/([ap])\.?\s*m/i, ''); }
  var digits = (s.match(/\d+/g) || []), h, mn;
  if (digits.length >= 2) { h = +digits[0]; mn = +digits[1]; }
  else if (digits.length === 1) { var d = digits[0];
    if (d.length <= 2) { h = +d; mn = 0; } else if (d.length === 3) { h = +d.slice(0, 1); mn = +d.slice(1); } else { h = +d.slice(0, 2); mn = +d.slice(2, 4); } }
  else return s;
  if (isNaN(h)) return s; if (isNaN(mn)) mn = 0;
  if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
  if (h > 23) h = 23; if (mn > 59) mn = 59;
  return ('0' + h).slice(-2) + ':' + ('0' + mn).slice(-2);
}
/* One-shot: rewrite every time / time_end cell to clean HH:MM (fixes "1800"
 * display and lets the dedupe collapse "1800" vs "18:00"). Safe to re-run. */
function normalizeTimes() {
  var sh = _sheet(), col = _headerIdx(sh);
  var last = sh.getLastRow(); if (last < 2) return 'empty';
  var rng = sh.getRange(2, 1, last - 1, sh.getLastColumn()), vals = rng.getValues(), n = 0;
  ['time', 'time_end'].forEach(function (c) {
    if (col[c] === undefined) return;
    for (var i = 0; i < vals.length; i++) {
      var cur = String(vals[i][col[c]] == null ? '' : vals[i][col[c]]);
      var nn = _normTime24(vals[i][col[c]]);
      if (nn !== cur) { vals[i][col[c]] = nn; n++; }
    }
  });
  if (n) rng.setValues(vals);
  Logger.log('normalizeTimes: fixed ' + n + ' time cell(s)');
  return 'normalizeTimes: fixed ' + n + ' time cell(s) → HH:MM';
}

/* ============================================================
 *  ANALYTICS  —  every track() call from the site lands here as
 *  one row in an "analytics" sheet tab (auto-created). Build a
 *  pivot table + chart on it in Sheets for a visual breakdown of
 *  clicks/filters — no separate dashboard needed.
 * ============================================================ */
function _analyticsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ANALYTICS_SHEET);
  if (!sh) { sh = ss.insertSheet(ANALYTICS_SHEET); sh.appendRow(ANALYTICS_COLS); }
  return sh;
}
function _track(data) {
  var sh = _analyticsSheet();
  var d = data.data || {};
  // flatten the first couple of custom fields into their own columns so pivoting is easy;
  // anything else gets folded into extra2 as a compact string.
  var keys = Object.keys(d);
  var extra1 = keys[0] ? String(d[keys[0]]).slice(0, 120) : '';
  var rest = keys.slice(1).map(function (k) { return k + '=' + d[k]; }).join('; ').slice(0, 200);
  sh.appendRow([new Date(), String(data.name || '').slice(0, 60), extra1, rest, '', String(data.page || '').slice(0, 120)]);
  return { ok: true };
}


/* ============================================================
 *  #1  TELEGRAM INTAKE
 *  Forward a WhatsApp poster to your bot → Claude parses it →
 *  you tap ✅ to publish (or 🗑 to drop). Setup in SETUP.md.
 * ============================================================ */
function _telegram(update) {
  try {
    if (update.callback_query) return _tgCallback(update.callback_query);
    var msg = update.message || update.channel_post;
    if (!msg) return _json({ ok: true });
    var chat = msg.chat.id;

    if (msg.photo && msg.photo.length) {                 // a poster image (+ optional caption)
      var img = _tgGetFileB64(msg.photo[msg.photo.length - 1].file_id);
      if (!img) { _tgSend(chat, '⚠ לא הצלחתי להוריד את התמונה.'); return _json({ ok: true }); }
      return _tgHandleEvents(chat, _scan({ image: img.dataUrl, mime: img.mime, text: msg.caption || '' }));
    }
    if (msg.text) {
      if (/^\/(start|help)/.test(msg.text)) {
        _tgSend(chat, 'שלחו לי צילום מסך של אירוע (או טקסט) ואני אחלץ את הפרטים ואשלח לכם לאישור. ✨');
        return _json({ ok: true });
      }
      return _tgHandleEvents(chat, _scan({ image: '', text: msg.text }));
    }
    _tgSend(chat, 'שלחו צילום מסך של אירוע 🙏');
    return _json({ ok: true });
  } catch (err) { return _json({ ok: true, error: String(err) }); }
}

function _tgHandleEvents(chat, res) {
  if (res.error) { _tgSend(chat, '⚠ ' + res.error); return _json({ ok: true }); }
  var evs = res.events || [];
  if (!evs.length) { _tgSend(chat, 'לא זוהה אירוע בהודעה. נסו צילום ברור יותר או כתבו את הפרטים.'); return _json({ ok: true }); }
  evs.forEach(function (ev) {
    var uid = _appendEvent(ev, false, 'telegram');
    _tgSend(chat, _evSummary(ev), { inline_keyboard: [[
      { text: '✅ אשר ופרסם', callback_data: 'ok:' + uid },
      { text: '🗑 מחק', callback_data: 'del:' + uid }
    ]]});
  });
  return _json({ ok: true });
}

function _tgCallback(cq) {
  var parts = String(cq.data || '').split(':'), act = parts[0], uid = parts[1];
  var chat = cq.message.chat.id, mid = cq.message.message_id, label;
  if (act === 'ok') { _approveByUid(uid); label = '✅ פורסם — יופיע בלוח בטעינה הבאה'; }
  else { _deleteByUid(uid); label = '🗑 נמחק'; }
  _tgApi('editMessageText', { chat_id: chat, message_id: mid, text: cq.message.text + '\n\n— ' + label });
  _tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: label });
  return _json({ ok: true });
}

function _evSummary(ev) {
  var L = ['📋 ' + (ev.title || '(ללא כותרת)'), '🗓 ' + (ev.date || '?') + '  ' + (ev.time || '')];
  if (ev.host) L.push('👤 ' + ev.host);
  L.push('📍 ' + [ev.venue, ev.city].filter(Boolean).join(', ') + (ev.region ? '  ·  ' + ev.region : ''));
  if (ev.category) L.push('🏷 ' + ev.category);
  if (ev.url && ev.url !== '#') L.push('🔗 ' + ev.url);
  return L.join('\n');
}

function _tgToken() { return PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN'); }
function _tgApi(method, payload) {
  var t = _tgToken(); if (!t) return null;
  return UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/' + method, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
}
function _tgSend(chat, text, replyMarkup) {
  var p = { chat_id: chat, text: text, disable_web_page_preview: true };
  if (replyMarkup) p.reply_markup = replyMarkup;
  return _tgApi('sendMessage', p);
}
function _tgGetFileB64(fileId) {
  var t = _tgToken(); if (!t) return null;
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/getFile?file_id=' + encodeURIComponent(fileId), { muteHttpExceptions: true });
  var j = JSON.parse(r.getContentText()); if (!j.ok) return null;
  var bin = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + t + '/' + j.result.file_path, { muteHttpExceptions: true });
  var blob = bin.getBlob(), mime = blob.getContentType() || 'image/jpeg';
  return { dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes()), mime: mime };
}

/** RUN ONCE after setting TELEGRAM_TOKEN (and WEBAPP_URL to your /exec URL): points the bot at this web app. */
function setTelegramWebhook() {
  var t = _tgToken(); if (!t) throw new Error('הוסיפי קודם TELEGRAM_TOKEN ב-Script Properties.');
  var url = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl();
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/setWebhook?url=' + encodeURIComponent(url), { muteHttpExceptions: true });
  Logger.log(r.getContentText()); return r.getContentText();
}


/* ============================================================
 *  #2  CALENDAR-FEED SYNC
 *  Put iCal feed URLs in a "feeds" tab: url | region | autoApprove
 *  Run installTriggers() once → pulls every 6 hours into the Sheet.
 * ============================================================ */
function syncFeeds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var fs = ss.getSheetByName('feeds');
  if (!fs) { fs = ss.insertSheet('feeds'); fs.appendRow(['url', 'region', 'autoApprove']); return 0; }
  var rows = fs.getDataRange().getValues(); rows.shift();
  var sh = _sheet(), existing = _existingUids(sh);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var horizon = new Date(today.getTime() + 120 * 864e5);
  var added = 0;
  rows.forEach(function (fr) {
    var url = (fr[0] || '').toString().trim(); if (!url) return;
    var region = (fr[1] || '').toString().trim();
    // iCal feeds are trusted structured sources → auto-approve (publish LIVE) by
    // default. Opt a specific feed OUT by putting FALSE/no in the autoApprove column.
    var _a = String(fr[2]).trim().toLowerCase(), auto = !(_a === 'false' || _a === 'no' || fr[2] === false);
    var ics; try { ics = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText(); } catch (e) { return; }
    _parseICS(ics).forEach(function (ev) {
      if (!ev._dt || ev._dt < today || ev._dt > horizon) return;
      var uid = 'ics_' + _hash(url + '|' + (ev.uid || (ev.date + ev.time + ev.title)));
      if (existing[uid]) return;
      ev.region = region || ev.region || '';
      _appendEvent(ev, auto, 'feed', uid);
      existing[uid] = true; added++;
    });
  });
  Logger.log('feeds: added ' + added); return added;
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['syncFeeds', 'syncInbox'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncInbox').timeBased().everyMinutes(5).create();   // Option B: share-to-Gmail
  ScriptApp.newTrigger('syncFeeds').timeBased().everyHours(6).create();      // Option 2: iCal feeds
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('feeds')) ss.insertSheet('feeds').appendRow(['url', 'region', 'autoApprove']);
  if (!GmailApp.getUserLabelByName(INBOX_LABEL)) GmailApp.createLabel(INBOX_LABEL);
  if (!GmailApp.getUserLabelByName(DONE_LABEL)) GmailApp.createLabel(DONE_LABEL);
  return 'OK — Gmail inbox checked every 5 min, feeds every 6 hours.';
}

/* ============================================================
 *  ONE-BUTTON AUTOMATION
 *  installAllZuzuTriggers()  — runs all four installers at once (idempotent:
 *    each installer first deletes its own old triggers, so re-running never
 *    stacks duplicates). Run once; the schedules then fire on their own.
 *  listZuzuTriggers()  — logs every trigger currently installed, so you can
 *    verify what's live without guessing. Run it and read View ▸ Logs.
 * ============================================================ */
function installAllZuzuTriggers() {
  var out = [];
  out.push('ecstatic: ' + (installEcstaticTrigger(), 'Sun ~07:00'));
  out.push('tribe: '    + (installTribeTrigger(),    'daily ~05:00'));
  out.push('dedupe: '   + (installDedupeTrigger(),   'daily ~04:00'));
  out.push('inbox+feeds: ' + installTriggers());
  var msg = 'installAllZuzuTriggers →\n  ' + out.join('\n  ');
  Logger.log(msg);
  return msg;
}
function listZuzuTriggers() {
  var ts = ScriptApp.getProjectTriggers();
  if (!ts.length) { Logger.log('NO triggers installed.'); return 'NO triggers installed.'; }
  var lines = ts.map(function (t) {
    return '• ' + t.getHandlerFunction() + '  (' + t.getEventType() + ')';
  });
  var msg = ts.length + ' trigger(s):\n' + lines.join('\n');
  Logger.log(msg);
  return msg;
}

/* ============================================================
 *  OPTION B  —  SHARE-TO-GMAIL INTAKE
 *  In WhatsApp: long-press a poster ▸ Share ▸ Gmail ▸ send to
 *  yourname+zuzu@gmail.com. A filter labels it "zuzu-inbox";
 *  this timer reads it, Claude parses it, it queues for your ✅.
 * ============================================================ */
function syncInbox() {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) { Logger.log('syncInbox: no ANTHROPIC_API_KEY'); return 0; }
  var inLab = GmailApp.getUserLabelByName(INBOX_LABEL);
  if (!inLab) { GmailApp.createLabel(INBOX_LABEL); GmailApp.createLabel(DONE_LABEL); return 0; }
  var doneLab = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var threads = inLab.getThreads(0, 15), added = 0;
  threads.forEach(function (th) {
    th.getMessages().forEach(function (msg) {
      var text = (msg.getPlainBody() || '').slice(0, 2000);
      var atts = msg.getAttachments({ includeInlineImages: true, includeAttachments: true });
      var imgs = atts.filter(function (a) { return /^image\//.test(a.getContentType()); });
      if (imgs.length) {
        imgs.forEach(function (a) {
          var dataUrl = 'data:' + a.getContentType() + ';base64,' + Utilities.base64Encode(a.getBytes());
          added += _writePending(_scan({ image: dataUrl, mime: a.getContentType(), text: text }));
        });
      } else if (text) {
        added += _writePending(_scan({ image: '', text: text }));
      }
    });
    th.removeLabel(inLab).addLabel(doneLab);
  });
  Logger.log('inbox: added ' + added); return added;
}
function _writePending(res) {
  if (!res || res.error || !res.events) return 0;
  var n = 0; res.events.forEach(function (ev) { _submitEvent(ev, false, 'email'); n++; }); return n;
}

function _parseICS(text) {
  if (!text) return [];
  text = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');   // unfold folded lines
  var blocks = text.split('BEGIN:VEVENT'); blocks.shift();
  var out = [];
  blocks.forEach(function (b) {
    var seg = b.split('END:VEVENT')[0];
    var dtRaw = _icsProp(seg, 'DTSTART'), dt = _icsDate(dtRaw);
    if (!dt) return;
    out.push({
      _dt: dt,
      date: Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      time: /\dT\d/.test(dtRaw) ? Utilities.formatDate(dt, Session.getScriptTimeZone(), 'HH:mm') : '',
      title: _icsUnesc(_icsProp(seg, 'SUMMARY')), venue: _icsUnesc(_icsProp(seg, 'LOCATION')),
      city: '', url: _icsProp(seg, 'URL') || '', uid: _icsProp(seg, 'UID'),
      category: '', host: '', price: ''
    });
  });
  return out;
}
function _icsProp(seg, name) {
  var m = seg.match(new RegExp('(?:^|\\n)' + name + '[^:\\n]*:([^\\n]*)'));
  return m ? m[1].replace(/\r$/, '').trim() : '';
}
function _icsDate(s) {
  var m = String(s || '').match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), 0);
}
function _icsUnesc(s) { return String(s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }


/* ---------- uid-keyed row helpers (shared by Telegram + feeds) ---------- */
function _ensureCol(sh, name) {
  var last = sh.getLastColumn();
  var h = sh.getRange(1, 1, 1, last).getValues()[0];
  var i = h.indexOf(name);
  if (i >= 0) return i;
  sh.getRange(1, last + 1).setValue(name);
  return last;          // 0-based index of the new column
}
function _appendEvent(ev, approved, source, forcedUid) {
  var sh = _sheet();
  var uidCol = _ensureCol(sh, 'uid'), srcCol = _ensureCol(sh, 'source');
  var uid = forcedUid || Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  var row = [
    new Date(), approved === true,
    ev.date || '', ev.time || '',
    (ev.title || '').toString().slice(0, 200),
    (ev.host || '').toString().slice(0, 120),
    ev.category || ev.discipline || '',
    (ev.venue || '').toString().slice(0, 160),
    ev.city || '', ev.region || '', ev.url || '', ev.price || ''
  ];
  var width = Math.max(sh.getLastColumn(), uidCol + 1, srcCol + 1);
  while (row.length < width) row.push('');
  row[uidCol] = uid; row[srcCol] = source || '';
  sh.appendRow(row);
  return uid;
}
function _existingUids(sh) {
  var uidCol = _ensureCol(sh, 'uid'), n = sh.getLastRow();
  var map = {}; if (n < 2) return map;
  var vals = sh.getRange(2, uidCol + 1, n - 1, 1).getValues();
  vals.forEach(function (r) { if (r[0]) map[String(r[0])] = true; });
  return map;
}
function _findRowByUid(sh, uid) {
  uid = String(uid == null ? '' : uid).trim();
  if (!uid) return -1;                     // never match on a blank uid — it would clobber the wrong row
  var uidCol = _ensureCol(sh, 'uid'), n = sh.getLastRow();
  if (n < 2) return -1;
  var vals = sh.getRange(2, uidCol + 1, n - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === uid) return i + 2;
  return -1;
}
/* Assign a uid to any row that is missing one, so the reviewer can always target
 * a row unambiguously. Without this, uid-less rows collide on '' and approve/reject
 * silently hits the wrong row — the event never leaves the pending queue. */
function _backfillUids(sh) {
  var uidCol = _ensureCol(sh, 'uid'), n = sh.getLastRow();
  if (n < 2) return;
  var rng = sh.getRange(2, uidCol + 1, n - 1, 1), vals = rng.getValues(), dirty = false;
  for (var i = 0; i < vals.length; i++) {
    if (!String(vals[i][0] == null ? '' : vals[i][0]).trim()) {
      vals[i][0] = Utilities.getUuid().replace(/-/g, '').slice(0, 10); dirty = true;
    }
  }
  if (dirty) rng.setValues(vals);
}
function _approveByUid(uid) {
  var sh = _sheet(), r = _findRowByUid(sh, uid); if (r < 0) return false;
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(r, h.indexOf('approved') + 1).setValue(true); return true;
}
function _deleteByUid(uid) {
  var sh = _sheet(), r = _findRowByUid(sh, uid); if (r < 0) return false;
  sh.deleteRow(r); return true;
}
function _hash(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('').slice(0, 12);
}
