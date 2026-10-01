/* ============================================================
 *  SOURCE PROBE — read-only. "Can we pull events from this site automatically?"
 *
 *  Paste this as a NEW file (+ ▸ Script) in the same Apps Script project as
 *  zuzu-events.gs, then run probeSources(). It fetches each site in PROBE_SITES,
 *  checks for every machine-readable event source we know how to ingest, and
 *  writes one row per site to a 'probe' tab. It never touches the events sheet.
 *
 *  Columns: site | http | platform | tribe_api | wp_types | rss | ical | jsonld_events | widgets | verdict
 *  Verdict tiers (best first):
 *    TRIBE   — add the domain to TRIBE_SOURCES; fully hands-off, already supported.
 *    ICAL    — paste the .ics URL into the 'feeds' tab; fully hands-off, already supported.
 *    WP-REST — WordPress exposes an events-like post type; needs a small adapter (dates may live in the body text).
 *    JSON-LD — page carries schema.org Event data; parseable without the LLM.
 *    WIDGET  — schedule lives in a 3rd-party booking widget (Tazman/coing/Arbox/…); per-platform adapter or none.
 *    LLM     — only free text; the existing _extractEventsFromUrl (Claude) path, review-gated.
 * ============================================================ */
var PROBE_SITES = [
  'https://ecstaticdance.co.il/', 'https://ci-events.org/', 'https://www.bodyways.org/',
  'https://www.biodanza.org.il/', 'https://www.choreographers.org.il/', 'https://www.gagapeople.com/',
  'https://www.studiotena.org/', 'https://www.siloculture.com/', 'https://love-soul.co.il/',
  'https://www.dinamania.com/', 'https://deepcontact.org/', 'https://www.hakvutza.org.il/',
  'https://www.shlomit.dance/yoman', 'https://flowmo.co.il/', 'https://teo.org.il/',
  'https://667714610dfa8.site123.me/', 'https://www.beingspace.co.il/', 'https://play4dance.com/',
  'https://www.naim.org.il/timetable', 'https://yogoda.co.il/', 'https://movementfreaks.com/',
  'https://pantarhei-studio.co.il/', 'https://www.contactil.org/', 'https://bonadance.com/itay-classes-tlv/',
  'https://vertigo.org.il/', 'https://iriserez.com/', 'https://www.lironina.com/',
  'https://www.sharonhilleli.com/', 'https://www.irisnais.com/', 'https://www.galitliss.com/',
  'https://studiotamara.co.il/', 'https://laban-movement.co.il/', 'https://www.daliastudio.com/',
  'https://www.tlvitim.co.il/', 'https://www.dancecommunityclub.com/', 'https://www.danyaelraz.com/',
  'https://www.yankalle.com/', 'https://www.orlyportal.co.il/', 'https://eutony.co.il/',
  'https://www.zuzima.net/', 'https://move-ment.co.il/', 'https://dalidance.co.il/',
  'https://michael-shachrur.com/', 'https://wildwomenisrael.com/', 'https://noakadman.com/',
  'https://adama.org.il/', 'https://shoshanasarah.com/', 'https://lvytn.org/',
  'https://www.bethlehemfoodforest.com/', 'https://www.tederness.co.il/', 'https://live.tickchak.co.il/',
  'https://www.contactimprov.com/israel.html'
];

var PROBE_UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ZuzuBot/1.0; +https://zuzu.today)' };
var PROBE_BUILTIN_TYPES = /^(post|page|attachment|nav_menu_item|wp_block|wp_template|wp_template_part|wp_navigation|wp_font_family|wp_font_face|wp_global_styles|elementor_library|e-landing-page|product|product_variation)$/;
var PROBE_EVENTISH = /event|workshop|course|class|schedule|program|retreat|session|sadna|tribe|mec|אירוע|סדנ|קורס|שיעור/i;
var PROBE_WIDGETS = [
  ['tazman', /tazman\.co\.il/i], ['coing', /coing\.co/i], ['arbox', /arboxapp\.com/i],
  ['tickchak', /tickchak/i], ['tederness', /tederness/i], ['eventer', /eventer\.co\.il/i],
  ['smarticket', /smarticket/i], ['eventbrite', /eventbrite\./i], ['wix-events', /wix-events|events-viewer|"eventsApp"/i],
  ['google-calendar', /calendar\.google\.com\/calendar\/(embed|ical)/i], ['ravpage', /ravpage\.co\.il/i],
  ['simplybook', /simplybook/i], ['calendly', /calendly\.com/i], ['mindbody', /mindbodyonline/i]
];

function probeSources() {
  var rows = [['site', 'http', 'platform', 'tribe_api', 'wp_types', 'rss', 'ical', 'jsonld_events', 'widgets', 'verdict']];
  PROBE_SITES.forEach(function (u) {
    try { rows.push(_probeOne(u)); }
    catch (e) { rows.push([u, 'ERR', '', '', '', '', '', '', '', 'unreachable: ' + String(e).slice(0, 120)]); }
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('probe') || ss.insertSheet('probe');
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  var msg = 'probeSources: ' + (rows.length - 1) + ' sites → see the "probe" tab';
  Logger.log(msg); return msg;
}

/** Probe one site. Four parallel requests: the page itself, Tribe REST, WP types list, RSS. */
function _probeOne(u) {
  var origin = u.match(/^https?:\/\/[^\/]+/)[0];
  var urls = [u, origin + '/wp-json/tribe/events/v1/events?per_page=1', origin + '/wp-json/wp/v2/types', origin + '/feed/'];
  var res = UrlFetchApp.fetchAll(urls.map(function (x) {
    return { url: x, muteHttpExceptions: true, followRedirects: true, headers: PROBE_UA };
  }));
  var page = res[0], code = page.getResponseCode(), html = code < 400 ? page.getContentText() : '';

  // platform fingerprint
  var platform = /static\.wixstatic\.com|wix-thunderbolt|_wixCssImports|wix\.com website builder/i.test(html) ? 'Wix'
    : /wp-content|wp-includes|\/wp-json\//i.test(html) ? 'WordPress'
    : /site123/i.test(html) ? 'site123'
    : /Drupal/i.test(html) ? 'Drupal'
    : /\.asp(\?|$)/i.test(u) || /\.asp[?"']/i.test(html) ? 'ASP'
    : /__NEXT_DATA__|id="root"|id="app"|supabase/i.test(html) ? 'JS app (React/Next)'
    : (html ? 'unknown' : '');

  // The Events Calendar (Tribe) REST — same API syncTribeEvents() already reads
  var tribe = '';
  if (res[1].getResponseCode() === 200) {
    try { var tj = JSON.parse(res[1].getContentText()); if (tj && tj.events) tribe = 'YES (' + (tj.total || tj.events.length) + ' upcoming)'; } catch (e) {}
  }

  // WordPress custom post types that look like events
  var wpTypes = '';
  if (res[2].getResponseCode() === 200) {
    try {
      var types = JSON.parse(res[2].getContentText()), custom = [];
      Object.keys(types).forEach(function (k) {
        if (PROBE_BUILTIN_TYPES.test(k)) return;
        var rb = types[k].rest_base || k;
        custom.push((PROBE_EVENTISH.test(k + ' ' + (types[k].name || '')) ? '★' : '') + k + '→/wp-json/wp/v2/' + rb);
      });
      wpTypes = custom.join(' ; ');
    } catch (e) {}
  }

  var rss = (res[3].getResponseCode() === 200 && /<rss|<feed/i.test(res[3].getContentText().slice(0, 500))) ? origin + '/feed/' : '';

  // iCal: direct .ics / webcal links, Tribe's ?ical=1, or a public Google Calendar embed (→ convertible to .ics)
  var ical = [];
  (html.match(/(?:webcal|https?):\/\/[^"'\s<>]+?(?:\.ics|[?&]ical=1|outlook-ical=1)[^"'\s<>]*/gi) || []).forEach(function (x) { ical.push(x); });
  (html.match(/calendar\.google\.com\/calendar\/embed\?[^"'\s<>]*src=([^&"'\s<>]+)/gi) || []).forEach(function (x) {
    var src = decodeURIComponent(x.replace(/.*src=/i, ''));
    ical.push('https://calendar.google.com/calendar/ical/' + encodeURIComponent(src) + '/public/basic.ics');
  });
  ical = ical.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 3);

  // schema.org Event objects in JSON-LD
  var ld = (html.match(/"@type"\s*:\s*\[?\s*"(?:Event|DanceEvent|EducationEvent|SocialEvent|Course|CourseInstance)"/g) || []).length;

  var widgets = PROBE_WIDGETS.filter(function (w) { return w[1].test(html); }).map(function (w) { return w[0]; });

  var verdict =
      tribe ? 'TRIBE — add ' + origin.replace(/^https?:\/\//, '') + ' to TRIBE_SOURCES'
    : ical.length ? 'ICAL — add to feeds tab'
    : /★/.test(wpTypes) ? 'WP-REST — events-like post type; small adapter'
    : ld ? 'JSON-LD — ' + ld + ' structured event(s) on page'
    : widgets.length ? 'WIDGET — ' + widgets.join('/') + '; per-platform adapter'
    : code >= 400 || !html ? 'BLOCKED/DOWN (HTTP ' + code + ')'
    : 'LLM — free text only (review-gated scrape) or manual';

  return [u, code, platform, tribe, wpTypes, rss, ical.join(' | '), ld || '', widgets.join(', '), verdict];
}

/* ============================================================
 *  DEEP PROBE — second pass on the candidates probeSources() flagged.
 *  Run probeDeep(); results go to a 'probe-deep' tab. Read-only.
 *   A) Wix Events sites: find individual event pages in the HTML and check
 *      whether they carry schema.org Event data (JSON-LD) with a startDate.
 *   B) WordPress sites with event/course post types: fetch 2 items per type and
 *      check whether real event dates sit in structured fields, only in the
 *      text, or in JSON-LD on the item's own page.
 * ============================================================ */
var DEEP_WIX = [   // [home, extra listing paths to scan for event links]
  ['https://www.studiotena.org/', ['event', 'class']],
  ['https://www.siloculture.com/', ['silocalender', 'events']],
  ['https://move-ment.co.il/', ['events']],
  ['https://www.irisnais.com/', ['events']],
  ['https://www.zuzima.net/', ['events']],
  ['https://wildwomenisrael.com/', ['events']],
  ['https://www.beingspace.co.il/', ['events']],
  ['https://www.bethlehemfoodforest.com/', ['events']],
  ['https://www.daliastudio.com/', ['events']]
];
var DEEP_WP = ['https://movementfreaks.com', 'https://pantarhei-studio.co.il', 'https://teo.org.il',
  'https://deepcontact.org', 'https://love-soul.co.il', 'https://yogoda.co.il'];
var DEEP_SKIP_FIELDS = ['date', 'date_gmt', 'modified', 'modified_gmt', 'content', 'excerpt', 'guid', '_links',
  'yoast_head', 'yoast_head_json', 'title', 'link', 'slug'];   // publish/edit dates are NOT event dates

function probeDeep() {
  var rows = [['site', 'kind', 'checked', 'items', 'sample title', 'dates in fields', 'dates in text', 'JSON-LD on item page', 'sample start', 'verdict']];
  DEEP_WIX.forEach(function (w) {
    try { rows.push(_deepWix(w[0], w[1])); }
    catch (e) { rows.push([w[0], 'wix', '', '', '', '', '', '', '', 'ERR ' + String(e).slice(0, 120)]); }
  });
  DEEP_WP.forEach(function (o) {
    try { _deepWp(o).forEach(function (r) { rows.push(r); }); }
    catch (e) { rows.push([o, 'wp', '', '', '', '', '', '', '', 'ERR ' + String(e).slice(0, 120)]); }
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('probe-deep') || ss.insertSheet('probe-deep');
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  var msg = 'probeDeep: ' + (rows.length - 1) + ' rows → see the "probe-deep" tab';
  Logger.log(msg); return msg;
}

function _deepFetchAll(urls) {
  if (!urls.length) return [];
  var opts = function (u) { return { url: u, muteHttpExceptions: true, followRedirects: true, headers: PROBE_UA }; };
  try { return UrlFetchApp.fetchAll(urls.map(opts)); }
  catch (e) {   // one DNS failure kills the whole batch → retry one by one
    return urls.map(function (u) { try { var o = opts(u); delete o.url; return UrlFetchApp.fetch(u, o); } catch (x) { return null; } });
  }
}
function _deepText(r) { return (r && r.getResponseCode() < 400) ? r.getContentText() : ''; }
function _deepStrip(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[#\w]+;/g, ' ').replace(/\s+/g, ' ').trim(); }

/** schema.org Event/Course objects in a page's JSON-LD → [{name, start}] */
function _deepLdEvents(html) {
  var out = [], re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, m;
  function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (/Event|Course/.test([].concat(o['@type'] || []).join(','))) out.push({ name: _deepStrip(o.name), start: o.startDate || '' });
    if (o['@graph']) walk(o['@graph']);
    if (o.hasCourseInstance) walk(o.hasCourseInstance);
  }
  while ((m = re.exec(html))) { try { walk(JSON.parse(m[1].trim())); } catch (e) {} }
  return out;
}

function _deepWix(home, paths) {
  var base = home.replace(/\/$/, '');
  var pages = _deepFetchAll([home].concat(paths.map(function (p) { return base + '/' + p; })));
  var links = {};
  pages.forEach(function (r) {
    var h = _deepText(r), re = /href="((?:https?:\/\/[^"\/]+)?\/(?:event-details|event-info|events)\/[^"?#\/]+)/gi, m;
    while ((m = re.exec(h))) { var u = m[1].charAt(0) === '/' ? base + m[1] : m[1]; if (u.indexOf(base.replace(/^https?:\/\/(www\.)?/, '')) >= 0) links[u] = 1; }
  });
  var list = Object.keys(links);
  if (!list.length) {
    var warm = pages.some(function (r) { return /"startDate"\s*:\s*"20\d\d-/.test(_deepText(r)); });
    return [home, 'wix', paths.join(', '), 0, '', warm ? 'startDate in embedded page JSON' : '', '', '', '',
      warm ? 'NO EVENT LINKS, but dates in Wix embedded JSON — possible, fragile'
           : 'NO EVENT LINKS in HTML (JS-rendered or no events) — Claude scrape only'];
  }
  var ld = [], warmD = false, title = '';
  _deepFetchAll(list.slice(0, 2)).forEach(function (r) {
    var h = _deepText(r);
    ld = ld.concat(_deepLdEvents(h));
    if (/"startDate"\s*:\s*"20\d\d-/.test(h)) warmD = true;
    if (!title) { var t = h.match(/<title>([^<]*)/i); if (t) title = _deepStrip(t[1]); }
  });
  var dated = ld.filter(function (e) { return e.start; });
  var verdict = dated.length ? 'STRUCTURED — JSON-LD Event with dates on event pages → Wix adapter, no Claude needed'
    : warmD ? 'SEMI — no JSON-LD, but startDate in Wix embedded JSON (fragile)'
    : 'LINKS ONLY — event pages exist but no machine-readable date → Claude per page';
  return [home, 'wix', list[0], list.length, (ld[0] && ld[0].name) || title, warmD ? 'startDate in embedded JSON' : '', '',
    ld.length ? ld.length + ' (' + dated.length + ' with startDate)' : 'none', dated.length ? dated[0].start : '', verdict];
}

function _deepWp(origin) {
  var types; try { types = JSON.parse(_deepText(_deepFetchAll([origin + '/wp-json/wp/v2/types'])[0]) || '{}'); } catch (e) { types = {}; }
  var cands = Object.keys(types).filter(function (k) {
    return !PROBE_BUILTIN_TYPES.test(k) && PROBE_EVENTISH.test(k + ' ' + (types[k].name || ''));
  });
  if (!cands.length) return [[origin, 'wp', '/wp-json/wp/v2/types', 0, '', '', '', '', '', 'no events-like post type exposed']];
  var urls = cands.map(function (k) { return origin + '/wp-json/wp/v2/' + (types[k].rest_base || k) + '?per_page=2'; });
  var lists = _deepFetchAll(urls);
  return cands.map(function (k, i) {
    var r = lists[i], items = null;
    try { items = JSON.parse(_deepText(r)); } catch (e) {}
    if (!Array.isArray(items)) return [origin, 'wp:' + k, urls[i], '', '', '', '', '', '', 'REST refused (HTTP ' + (r ? r.getResponseCode() : 'ERR') + ')'];
    var h = r.getHeaders(), total = h['X-WP-Total'] || h['x-wp-total'] || items.length;
    if (!items.length) return [origin, 'wp:' + k, urls[i], 0, '', '', '', '', '', 'EMPTY — type exists but has no items'];
    var it = items[0], title = _deepStrip(it.title && it.title.rendered);
    var text = _deepStrip(((it.content && it.content.rendered) || '') + ' ' + ((it.excerpt && it.excerpt.rendered) || ''));
    // structured fields: drop WP's own publish/edit dates, then look for date-ish keys or values
    var copy = JSON.parse(JSON.stringify(it)); DEEP_SKIP_FIELDS.forEach(function (f) { delete copy[f]; });
    var flat = JSON.stringify(copy), hits = [], m;
    var reF = /"([\w-]*(?:date|start|_time|day)[\w-]*)"\s*:\s*"?([^",}\]]{4,30})/gi;
    while ((m = reF.exec(flat)) && hits.length < 4) { if (/\d/.test(m[2])) hits.push(m[1] + '=' + m[2]); }
    var reV = /"([\w-]+)"\s*:\s*"(20\d\d-\d\d-\d\d[^"]{0,9}|\d{1,2}[\/.]\d{1,2}[\/.](?:20)?\d\d)"/g;
    while ((m = reV.exec(flat)) && hits.length < 4) { var kv = m[1] + '=' + m[2]; if (hits.indexOf(kv) < 0) hits.push(kv); }
    var textDate = /\b\d{1,2}[.\/]\d{1,2}(?:[.\/](?:20)?\d{2})?\b|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|יום [אבגדהו]['׳]/.test(title + ' ' + text);
    var ld = it.link ? _deepLdEvents(_deepText(_deepFetchAll([it.link])[0])) : [];
    var dated = ld.filter(function (e) { return e.start; });
    var verdict = dated.length ? 'STRUCTURED — JSON-LD with dates on item pages'
      : hits.length ? 'STRUCTURED — dates in REST fields → adapter, no Claude needed'
      : textDate ? 'SEMI — items via REST, dates only in text → Claude reads each item'
      : 'NO DATES visible — likely evergreen course/info pages, not dated events';
    return [origin, 'wp:' + k, it.link || urls[i], total, title, hits.join(' ; '), textDate ? 'yes' : '',
      ld.length ? ld.length + ' (' + dated.length + ' with startDate)' : 'none', dated.length ? dated[0].start : '', verdict];
  });
}
