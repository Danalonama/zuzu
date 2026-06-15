/**
 * Zuzu — events backend (Google Apps Script)
 * ------------------------------------------------------------
 * Acts as a tiny free server on top of a Google Sheet:
 *   • POST  → a visitor submitted an event  → appended as a new row, approved = FALSE
 *   • GET ?action=approved → returns every row whose "approved" box is checked, as JSON
 *
 * You moderate simply by ticking the "approved" checkbox in the Sheet.
 * See SETUP.md for the 5-minute install.
 */

// The tab (sheet) name inside your spreadsheet:
var SHEET_NAME = 'events';

// Column order written to the sheet. Row 1 must contain these headers.
var COLS = ['timestamp','approved','date','time','title','host','category','venue','city','region','url','price'];

function _sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLS);
  }
  return sh;
}

/** A visitor submitted an event from the website. */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sh = _sheet();
    sh.appendRow([
      new Date(),
      false,                       // approved — you tick this manually
      data.date || '',
      data.time || '',
      (data.title || '').toString().slice(0, 200),
      (data.host || '').toString().slice(0, 120),
      data.category || '',
      (data.venue || '').toString().slice(0, 160),
      data.city || '',
      data.region || '',
      data.url || '',
      data.price || ''
    ]);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/** The website asks for the approved events to display. */
function doGet(e) {
  var sh = _sheet();
  var rows = sh.getDataRange().getValues();
  var header = rows.shift() || [];
  var idx = {};
  header.forEach(function (h, i) { idx[h] = i; });

  var out = [];
  rows.forEach(function (r) {
    if (r[idx.approved] !== true) return;           // only approved
    var ev = {
      date: _d(r[idx.date]),
      time: _t(r[idx.time]),
      title: r[idx.title],
      category: r[idx.category],
      venue: r[idx.venue],
      city: r[idx.city] || null,
      region: r[idx.region],
      url: r[idx.url] || '#',
      price: r[idx.price] || null,
      image: null,
      recurring: false
    };
    if (r[idx.host]) ev.host = r[idx.host];
    out.push(ev);
  });
  return _json(out);
}

/* ---------- helpers ---------- */
function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
// Normalise a date cell to "YYYY-MM-DD" whether it's a Date or text.
function _d(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '');
}
// Normalise a time cell to "HH:mm" whether it's a Date or text.
function _t(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  return String(v || '');
}
