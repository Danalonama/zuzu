/**
 * zuzu — one-off feed probe (2026-10-01). NOT part of zuzu-events.gs.
 * Paste into a NEW scratch Apps Script project (script.new), run probeFeeds(),
 * then View → Logs. Each line: status · looks-like · count/size · URL.
 * It only fetches (GET); it writes nothing anywhere.
 * See docs/feed-leads-2026-10-01.md for what each lead is.
 */
var PROBE_URLS = [
  // ecstaticdance.co.il is scraped today; URL patterns suggest Tribe → could replace the scraper
  'https://ecstaticdance.co.il/wp-json/tribe/events/v1/events?per_page=5',
  'https://ecstaticdance.co.il/events/?ical=1',
  // ci-events.org — Israeli contact-improv events board
  'https://www.ci-events.org/wp-json/tribe/events/v1/events?per_page=5',
  'https://www.ci-events.org/?ical=1',
  'https://www.ci-events.org/events/?ical=1',
  'https://www.ci-events.org/',
  // Studio Naim — some URLs look WordPress now
  'https://www.naim.org.il/wp-json/tribe/events/v1/events?per_page=5',
  'https://www.naim.org.il/wp-json/',
  // Hakvutza (TLV contact jam)
  'https://www.hakvutza.org.il/wp-json/tribe/events/v1/events?per_page=5',
  'https://www.hakvutza.org.il/wp-json/wp/v2/categories?search=events',
  // Muslala (Jerusalem)
  'https://muslala.org/wp-json/tribe/events/v1/events?per_page=5',
  'https://muslala.org/events/?ical=1',
  // Pantarhei (Ginegar)
  'https://pantarhei-studio.co.il/wp-json/tribe/events/v1/events?per_page=5',
  'https://pantarhei-studio.co.il/wp-json/wp/v2/types',
  // Vertigo
  'https://vertigo.org.il/wp-json/tribe/events/v1/events?per_page=5',
  // intimim (mostly out of scope — needs strict filter if it works)
  'https://intimim.co.il/wp-json/tribe/events/v1/events?per_page=5',
  // Secret Tel Aviv
  'https://www.secrettelaviv.com/wp-json/tribe/events/v1/events?per_page=5',
  // yoga.co.il
  'https://yoga.co.il/wp-json/tribe/events/v1/events?per_page=5',
  // 5Rhythms Israel directory (HTML — look for .ics links)
  'https://www.5rhythms.com/EventSearch.php?event_country=IL&Type=1',
  // Biodanza Israel weekly groups (HTML)
  'https://www.biodanza.org.il/MobileUc.aspx?ucType=DancerActivities&type=2',
  // Tederness (look for JSON-LD Event / __NEXT_DATA__)
  'https://tederness.co.il/',
  // coing — org events page (look for JSON / ics)
  'https://www.coing.co/TLV_Magid_Nordaou_Studio/events'
];

function probeFeeds() {
  PROBE_URLS.forEach(function (url) {
    var code = 'ERR', kind = '', info = '';
    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      code = res.getResponseCode();
      var body = res.getContentText();
      if (/BEGIN:VCALENDAR/.test(body)) {
        kind = 'ICS'; info = (body.match(/BEGIN:VEVENT/g) || []).length + ' VEVENTs';
      } else if (/^\s*[\{\[]/.test(body)) {
        kind = 'JSON';
        try {
          var j = JSON.parse(body);
          if (j.events) info = 'tribe total=' + j.total + ' first=' + (j.events[0] ? j.events[0].start_date + ' ' + j.events[0].title : '-');
          else info = 'keys=' + Object.keys(j).slice(0, 8).join(',');
        } catch (e) { info = 'unparseable'; }
      } else {
        kind = 'HTML';
        var hints = [];
        if (/"@type"\s*:\s*"Event"/.test(body)) hints.push('JSON-LD Event');
        if (/__NEXT_DATA__/.test(body)) hints.push('__NEXT_DATA__');
        if (/wp-content/.test(body)) hints.push('WordPress');
        if (/wixstatic|_wix/.test(body)) hints.push('Wix');
        if (/tribe-events/.test(body)) hints.push('Tribe markup');
        var ics = body.match(/https?:[^"'\s]+\.ics[^"'\s]*/);
        if (ics) hints.push('ics link: ' + ics[0]);
        var gcal = body.match(/calendar\.google\.com\/calendar\/embed\?src=([^"&]+)/);
        if (gcal) hints.push('Google Calendar: ' + decodeURIComponent(gcal[1]));
        info = (hints.join(' | ') || 'no hints') + ' (' + body.length + ' chars)';
      }
    } catch (e) { info = String(e).slice(0, 120); }
    Logger.log(code + ' · ' + kind + ' · ' + info + ' · ' + url);
  });
}
