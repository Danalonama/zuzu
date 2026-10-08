/* ============================================================
 *  DEEP SOURCE PROBE — read-only second pass on what probeSources() flagged.
 *
 *  Lives in the same Apps Script project as source-probe.gs and reuses its
 *  PROBE_UA / PROBE_BUILTIN_TYPES / PROBE_EVENTISH. Run probeDeep(); one row
 *  per site (Wix) or per post type (WordPress) goes to a 'probe-deep' tab.
 *  It never touches the events sheet. Findings feed the v2 adapters, not v1
 *  (v1 is frozen: no new sources in Apps Script).
 *
 *   A) Wix Events sites: collect event-page URLs from the site's sitemap and
 *      from the listing pages, open up to DEEP_WIX_SAMPLE of them, and check
 *      for schema.org Event JSON-LD with a startDate (and how many are future).
 *   B) WordPress sites with event/course post types: fetch 2 items per type and
 *      report whether event dates sit in structured fields, only in the text,
 *      or in JSON-LD on the item's own page.
 *
 *  Verdicts:
 *    STRUCTURED — machine-readable dates; an adapter needs no Claude.
 *    SEMI       — the list is structured, dates only in text; Claude reads each new item.
 *    LINKS ONLY / NO EVENT LINKS / NO DATES — free-text scrape or nothing.
 * ============================================================ */
var DEEP_WIX = [   // [home, extra listing paths to scan for event links]
  ['https://www.studiotena.org/', ['event', 'class']],
  ['https://www.siloculture.com/', ['silocalender', 'events']],
  ['https://www.daliastudio.com/', ['events']],
  ['https://www.zuzima.net/', ['events']],
  ['https://move-ment.co.il/', ['events']],
  ['https://www.irisnais.com/', ['events']],
  ['https://wildwomenisrael.com/', ['events']],
  ['https://www.beingspace.co.il/', ['events']],
  ['https://www.bethlehemfoodforest.com/', ['events']],
  ['https://www.dinamania.com/', ['events']],
  ['https://www.contactil.org/', ['events']]
];
var DEEP_WIX_SAMPLE = 5;
var DEEP_WP = ['https://deepcontact.org', 'https://pantarhei-studio.co.il', 'https://teo.org.il',
  'https://movementfreaks.com', 'https://love-soul.co.il', 'https://yogoda.co.il'];
var DEEP_WP_EXTRA_TYPES = { 'https://teo.org.il': ['dance'] };   // relevant types PROBE_EVENTISH doesn't match
var DEEP_SKIP_FIELDS = ['date', 'date_gmt', 'modified', 'modified_gmt', 'content', 'excerpt', 'guid', '_links',
  'yoast_head', 'yoast_head_json', 'title', 'link', 'slug'];   // publish/edit dates are NOT event dates
var DEEP_NOT_EVENT_DATE = /disc|discount|early|deadline|expire|until|_field_/i;   // e.g. Deep Contact's early-bird cut-offs

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
function _deepToday() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

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

/** Event-page URLs listed in a Wix site's sitemap index (child sitemaps whose URL mentions "event"). */
function _deepWixSitemap(base) {
  var idx = _deepText(_deepFetchAll([base + '/sitemap.xml'])[0]), urls = [];
  var subs = (idx.match(/<loc>[^<]*event[^<]*<\/loc>/gi) || []).map(function (x) { return x.replace(/<\/?loc>/gi, ''); });
  _deepFetchAll(subs.slice(0, 3)).forEach(function (r) {
    (_deepText(r).match(/<loc>[^<]+<\/loc>/gi) || []).forEach(function (x) {
      var u = x.replace(/<\/?loc>/gi, '');
      if (/\/(event-details|event-info|events)\/[^\/]+/.test(u)) urls.push(u);
    });
  });
  return { subs: subs.length, urls: urls };
}

function _deepWix(home, paths) {
  var base = home.replace(/\/$/, ''), host = base.replace(/^https?:\/\/(www\.)?/, '');
  var links = {};
  var sm = _deepWixSitemap(base);
  sm.urls.forEach(function (u) { links[u] = 1; });
  var pages = _deepFetchAll([home].concat(paths.map(function (p) { return base + '/' + p; })));
  var fromHtml = 0;
  pages.forEach(function (r) {
    var h = _deepText(r), re = /href="((?:https?:\/\/[^"\/]+)?\/(?:event-details|event-info|events)\/[^"?#\/]+)/gi, m;
    while ((m = re.exec(h))) {
      var u = m[1].charAt(0) === '/' ? base + m[1] : m[1];
      if (u.indexOf(host) >= 0 && !links[u]) { links[u] = 1; fromHtml++; }
    }
  });
  var list = Object.keys(links);
  var found = 'sitemap: ' + sm.urls.length + (sm.subs ? '' : ' (no event sitemap)') + ' · page links: ' + fromHtml;
  if (!list.length) return [home, 'wix', found, 0, '', '', '', '', '',
    'NO EVENT LINKS (no event sitemap, links JS-rendered) — Claude scrape only'];

  // newest-looking URLs first: slugs often end in a date, and sitemaps are unordered
  list.sort().reverse();
  var ld = [], title = '';
  _deepFetchAll(list.slice(0, DEEP_WIX_SAMPLE)).forEach(function (r) {
    var h = _deepText(r);
    ld = ld.concat(_deepLdEvents(h));
    if (!title) { var t = h.match(/<title>([^<]*)/i); if (t) title = _deepStrip(t[1]); }
  });
  var today = _deepToday();
  var dated = ld.filter(function (e) { return e.start; });
  var future = dated.filter(function (e) { return String(e.start).slice(0, 10) >= today; });
  var verdict = !dated.length ? 'LINKS ONLY — event pages exist but no machine-readable date → Claude per page'
    : (sm.urls.length ? 'STRUCTURED — sitemap lists event pages + JSON-LD dates → Wix adapter, no Claude'
                      : 'STRUCTURED pages, but no event sitemap — adapter only sees links in the HTML (partial)');
  var latest = dated.map(function (e) { return String(e.start); }).sort().pop() || '';
  return [home, 'wix', found, list.length, (ld[0] && ld[0].name) || title, '', '',
    ld.length ? ld.length + ' sampled (' + dated.length + ' dated, ' + future.length + ' future)' : 'none', latest, verdict];
}

function _deepWp(origin) {
  var types; try { types = JSON.parse(_deepText(_deepFetchAll([origin + '/wp-json/wp/v2/types'])[0]) || '{}'); } catch (e) { types = {}; }
  var extra = DEEP_WP_EXTRA_TYPES[origin] || [];
  var cands = Object.keys(types).filter(function (k) {
    return extra.indexOf(k) >= 0 || (!PROBE_BUILTIN_TYPES.test(k) && PROBE_EVENTISH.test(k + ' ' + (types[k].name || '')));
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
    // structured fields: drop WP's own publish/edit dates and known non-event dates, then look for date-ish keys/values
    var copy = JSON.parse(JSON.stringify(it)); DEEP_SKIP_FIELDS.forEach(function (f) { delete copy[f]; });
    var flat = JSON.stringify(copy), hits = [], m;
    var reF = /"([\w-]*(?:date|start|_time|day)[\w-]*)"\s*:\s*"?([^",}\]]{4,30})/gi;
    while ((m = reF.exec(flat)) && hits.length < 4) { if (/\d/.test(m[2]) && !DEEP_NOT_EVENT_DATE.test(m[1])) hits.push(m[1] + '=' + m[2]); }
    var reV = /"([\w-]+)"\s*:\s*"(20\d\d-\d\d-\d\d[^"]{0,9}|\d{1,2}[\/.]\d{1,2}[\/.](?:20)?\d\d)"/g;
    while ((m = reV.exec(flat)) && hits.length < 4) {
      var kv = m[1] + '=' + m[2]; if (!DEEP_NOT_EVENT_DATE.test(m[1]) && hits.indexOf(kv) < 0) hits.push(kv);
    }
    var dateRe = /\b\d{1,2}[.\/]\d{1,2}(?:[.\/](?:20)?\d{2})?\b|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|יום [אבגדהו]['׳]/;
    var titleDate = dateRe.test(title), textDate = titleDate || dateRe.test(text);
    var ld = it.link ? _deepLdEvents(_deepText(_deepFetchAll([it.link])[0])) : [];
    var dated = ld.filter(function (e) { return e.start; });
    var verdict = dated.length ? 'STRUCTURED — JSON-LD with dates on item pages (check they are current)'
      : hits.length ? 'STRUCTURED — dates in REST fields → adapter, no Claude needed'
      : titleDate ? 'STRUCTURED-ish — date/time in the TITLE in a fixed pattern → regex adapter'
      : textDate ? 'SEMI — items via REST, dates only in text → Claude reads each item'
      : 'NO DATES visible — likely evergreen course/info pages, not dated events';
    return [origin, 'wp:' + k, it.link || urls[i], total, title, hits.join(' ; '), titleDate ? 'in title' : (textDate ? 'in text' : ''),
      ld.length ? ld.length + ' (' + dated.length + ' with startDate)' : 'none', dated.length ? dated[0].start : '', verdict];
  });
}
