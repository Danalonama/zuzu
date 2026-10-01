/* ============================================================
 *  SOURCE PROBE — read-only. "Can we pull events from this site automatically?"
 *
 *  Lives as a separate file in the same Apps Script project as zuzu-events.gs.
 *  Run probeSources(). It fetches each site in PROBE_SITES, checks for every
 *  machine-readable event source we know how to ingest, and writes one row per
 *  site to a 'probe' tab. It never touches the events sheet.
 *
 *  Columns: site | http | platform | tribe_api | wp_types | rss | ical | jsonld_events | widgets | verdict
 *  Verdict tiers (best first):
 *    TRIBE   — add the domain to TRIBE_SOURCES; hands-off, already supported (publishes LIVE).
 *    ICAL    — paste the .ics URL into the 'feeds' tab; hands-off, already supported (publishes LIVE).
 *              Only given when the .ics was fetched and holds ≥2 VEVENTs (a 1-event file is
 *              an "add to calendar" button, not a feed).
 *    WP-REST — WordPress exposes an events-like post type; needs a small adapter (dates may live in the body text).
 *    JSON-LD — page carries schema.org Event data. No direct parser yet: today it goes to the
 *              LLM path via _extractJsonLd; a non-LLM adapter would be new code.
 *    WIDGET  — schedule lives in a 3rd-party booking widget (Tazman/coing/Arbox/…); per-platform adapter or none.
 *    LLM     — only free text; the existing _extractEventsFromUrl (Claude) path, review-gated.
 *
 *  Caveat: Apps Script fetches raw HTML, no JS. Wix / React sites that inject
 *  widgets or calendar iframes client-side will under-report here.
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
var PROBE_BUDGET_MS = 5 * 60 * 1000;   // Apps Script kills runs at 6 min — stop early and write what we have
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
  var t0 = Date.now(), skipped = 0;
  PROBE_SITES.forEach(function (u) {
    if (Date.now() - t0 > PROBE_BUDGET_MS) { skipped++; rows.push([u, '', '', '', '', '', '', '', '', 'SKIPPED — time budget; re-run with fewer sites']); return; }
    try { rows.push(_probeOne(u)); }
    catch (e) { rows.push([u, 'ERR', '', '', '', '', '', '', '', 'unreachable: ' + String(e).slice(0, 120)]); }
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('probe') || ss.insertSheet('probe');
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  var msg = 'probeSources: ' + (rows.length - 1 - skipped) + ' sites probed' + (skipped ? ', ' + skipped + ' skipped (time)' : '') + ' → see the "probe" tab';
  Logger.log(msg); return msg;
}

/** Probe one site. Four parallel requests: the page itself, Tribe REST, WP types list, RSS. */
function _probeOne(u) {
  var origin = u.match(/^https?:\/\/[^\/]+/)[0], host = origin.replace(/^https?:\/\//, '');
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
  var tribeKnown = typeof TRIBE_SOURCES !== 'undefined' && TRIBE_SOURCES.some(function (s) { return s.domain === host; });

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
  (html.match(/(?:webcal|https?):\/\/[^"'\s<>]+?(?:\.ics|[?&]ical=1|outlook-ical=1)[^"'\s<>]*/gi) || []).forEach(function (x) {
    ical.push(x.replace(/&amp;/g, '&').replace(/^webcal:/i, 'https:'));   // syncFeeds' UrlFetchApp can't fetch webcal://
  });
  (html.match(/calendar\.google\.com\/calendar\/embed\?[^"'\s<>]*src=([^&"'\s<>]+)/gi) || []).forEach(function (x) {
    var src = decodeURIComponent(x.replace(/.*src=/i, ''));
    ical.push('https://calendar.google.com/calendar/ical/' + encodeURIComponent(src) + '/public/basic.ics');
  });
  ical = ical.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 3);
  // Verify each candidate: must be a real VCALENDAR (private Google calendars 404) with ≥2 events
  var icalFeeds = [], icalNotes = [];
  if (ical.length) {
    var ir = UrlFetchApp.fetchAll(ical.map(function (x) {
      return { url: x, muteHttpExceptions: true, followRedirects: true, headers: PROBE_UA };
    }));
    ical.forEach(function (x, i) {
      var c = ir[i].getResponseCode(), body = c === 200 ? ir[i].getContentText() : '';
      var n = /BEGIN:VCALENDAR/.test(body) ? (body.match(/BEGIN:VEVENT/g) || []).length : -1;
      if (n >= 2) icalFeeds.push(x);
      icalNotes.push(x + (n < 0 ? ' [HTTP ' + c + ', not iCal]' : ' [' + n + ' VEVENT]'));
    });
  }

  // schema.org Event objects in JSON-LD
  var ld = (html.match(/"@type"\s*:\s*\[?\s*"(?:Event|DanceEvent|EducationEvent|SocialEvent|Course|CourseInstance)"/g) || []).length;

  var widgets = PROBE_WIDGETS.filter(function (w) { return w[1].test(html); }).map(function (w) { return w[0]; });

  var verdict =
      tribe ? (tribeKnown ? 'TRIBE — already in TRIBE_SOURCES' : 'TRIBE — add ' + host + ' to TRIBE_SOURCES')
    : icalFeeds.length ? 'ICAL — add ' + icalFeeds[0] + ' to feeds tab'
    : /★/.test(wpTypes) ? 'WP-REST — events-like post type; small adapter'
    : ld ? 'JSON-LD — ' + ld + ' structured event(s) on page (no direct parser yet; LLM path reads it)'
    : widgets.length ? 'WIDGET — ' + widgets.join('/') + '; per-platform adapter'
    : code >= 400 || !html ? 'BLOCKED/DOWN (HTTP ' + code + ')'
    : 'LLM — free text only (review-gated scrape) or manual';

  return [u, code, platform, tribe, wpTypes, rss, icalNotes.join(' | '), ld || '', widgets.join(', '), verdict];
}
