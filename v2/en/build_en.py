"""Builds en.html (zuzu.today/en) from index.html.

Run from the repo root after any change to index.html:
    python3 v2/en/build_en.py
Every replacement must match. If index.html changed a string this script
relies on, it stops and names it, so the English page never drifts silently.
"""
import re
import sys

SRC, DST = "index.html", "en.html"
s = open(SRC, encoding="utf-8").read()


def cut(start, end, keep_end=True):
    """Remove the text from `start` up to `end` (end kept unless keep_end=False)."""
    global s
    a = s.find(start)
    b = s.find(end, a + 1)
    if a < 0 or b < 0:
        sys.exit(f"build_en: block not found: {start[:60]!r} … {end[:40]!r}")
    s = s[:a] + s[b if keep_end else b + len(end):]


def rep(old, new, count=None):
    global s
    n = s.count(old)
    if n == 0 or (count is not None and n != count):
        sys.exit(f"build_en: expected {count or '1+'} of {old[:80]!r}, found {n}")
    s = s.replace(old, new)


# ---------- remove parts that stay Hebrew-only for now ----------
# add-event / contact / admin dialogs (the forms send in Hebrew; /en links to the Hebrew site)
cut('<div id="addModal" class="modal" hidden>', "<footer>")
# add-event form script + design "Tweaks" panel
cut("<script>\n/* ---- Add-event form + moderation panel ---- */", "<!-- Vercel Web Analytics")
# PWA: service worker + install pill (the app installs the Hebrew site)
cut("<!-- PWA service worker -->", "</body>")

# ---------- head ----------
rep('<html lang="he" dir="rtl">', '<html lang="en" dir="ltr">')
rep("<title>zuzu — איפה רוקדים היום? לוח שיעורי ריקוד, קונטקט, ג'אמים וסדנאות תנועה בישראל</title>",
    "<title>zuzu — where to dance today? Dance classes, contact jams and movement workshops in Israel</title>")
rep('<meta name="description" content="לוח האירועים של zuzu: שיעורי ריקוד, קונטקט אימפרוביזציה, אקסטטיק דאנס, ג\'אמים, סדנאות וריטריטים ברחבי ישראל. לכל גיל ולכל רמה — כולל מי שמעולם לא רקד/ה.">',
    '<meta name="description" content="zuzu\'s calendar of dance classes, contact improvisation, ecstatic dance, jams, workshops and retreats across Israel. For every age and level, including people who have never danced.">')
rep('<link rel="canonical" href="https://zuzu.today/">', '<link rel="canonical" href="https://zuzu.today/en">')
rep('content="zuzu — איפה רוקדים היום?"', 'content="zuzu — where to dance today?"', 2)
rep('<meta property="og:description" content="לוח האירועים של zuzu: שיעורי ריקוד, קונטקט אימפרוביזציה, אקסטטיק דאנס, ג\'אמים, סדנאות וריטריטים ברחבי ישראל.">',
    '<meta property="og:description" content="Dance classes, contact improvisation, ecstatic dance, jams, workshops and retreats across Israel.">')
rep('<meta property="og:url" content="https://zuzu.today/">', '<meta property="og:url" content="https://zuzu.today/en">')
rep('<meta property="og:locale" content="he_IL">', '<meta property="og:locale" content="en_US">')
rep('<meta name="twitter:description" content="לוח האירועים של zuzu: שיעורי ריקוד, קונטקט, אקסטטיק, ג\'אמים וסדנאות תנועה בישראל.">',
    '<meta name="twitter:description" content="Dance classes, contact, ecstatic dance, jams and movement workshops in Israel.">')
rep('<link rel="manifest" href="manifest.webmanifest">\n', "")
rep('"description": "לוח האירועים לתנועה וריקוד בישראל — שיעורי ריקוד, קונטקט אימפרוביזציה, אקסטטיק דאנס, ג\'אמים, סדנאות ורטריטים.",',
    '"description": "The calendar of movement and dance in Israel: dance classes, contact improvisation, ecstatic dance, jams, workshops and retreats.",')
rep('"url": "https://zuzu.today/",', '"url": "https://zuzu.today/en",')
rep('"inLanguage": "he",', '"inLanguage": "en",')
rep('"target": "https://zuzu.today/?q={search_term_string}",', '"target": "https://zuzu.today/en?q={search_term_string}",')

# ---------- CSS: right-to-left → left-to-right ----------
rep(".rulerWrap{direction:rtl;", ".rulerWrap{direction:ltr;")
rep(".ruler{flex:1 1 auto;direction:rtl;", ".ruler{flex:1 1 auto;direction:ltr;")
rep(".more .ar{transform:translateX(-5px)}", ".more .ar{transform:translateX(5px)}", 3)

# English button texts are longer than the Hebrew ones: let the card footer wrap on narrow phones
rep(".card .more .nolink{color:var(--muted);font-weight:600}",
    ".card .more .nolink{color:var(--muted);font-weight:600}\n"
    "  @media(max-width:400px){.card .end{flex-wrap:wrap;row-gap:10px}}")
# Hebrew titles, names and places keep their own direction inside the English page
rep('<h3 class="ti">${e.title}</h3>', '<h3 class="ti" dir="auto">${e.title}</h3>')
rep('<div class="meta">${loc}</div>', '<div class="meta" dir="auto">${loc}</div>')
rep('<span class="h">${e.time}</span> ${e.title}</span>', '<span class="h">${e.time}</span> <bdi>${e.title}</bdi></span>')

# the Hebrew page sets these from its design-tweaks script (removed here); use its defaults
rep("<body>", '<body data-dir="gallery" data-cards="minimal" data-motion="subtle">', 1)
# search box: the icon sits at the start, so the text padding moves to the start too
rep("border-radius:11px;padding:0 42px 0 38px;", "border-radius:11px;padding:0 38px 0 42px;")
rep("#searchInput{padding:0 36px 0 14px;font-size:16px}", "#searchInput{padding:0 14px 0 36px;font-size:16px}")
# wordmark: "zuzu." reads left to right
rep('flex:none">.zuzu<sup', 'flex:none">zuzu.<sup')
# Hebrew titles keep their letter order (dir="auto") but line up with the English text
rep(".card .thumb .bk{opacity:0}", ".card .thumb .bk{opacity:0}\n  .card .ti,.card .meta{text-align:left}")

# ---------- page text ----------
rep('href="#main">דלגו לתוכן הראשי</a>', 'href="#main">Skip to main content</a>')
rep('aria-label="zuzu — חזרה לעמוד הבית"', 'aria-label="zuzu — back to the home page"')
rep('<span class="ttag">איפה רוקדים היום?</span>', '<span class="ttag">where to dance today?</span>')
# top-right links (quiz + install are Hebrew pages) → one link back to the Hebrew site
cut('      <a class="tinstall quizlink" href="quiz.html"', "    </div>\n  </div>\n\n</header>")
rep("    <div class=\"tright\">\n    </div>\n  </div>\n\n</header>",
    '    <div class="tright">\n      <a class="tinstall langlink" href="/" lang="he" hreflang="he" style="font-weight:700"><span>עברית</span></a>\n    </div>\n  </div>\n\n</header>')
rep('aria-label="חיפוש וסינון"', 'aria-label="Search and filters"')
rep("<span>סינון</span>", "<span>Filter</span>")
rep('placeholder="חיפוש מורה, שיעור או מקום…" aria-label="חיפוש מורה, שיעור או מקום"',
    'placeholder="Search a teacher, class or place…" aria-label="Search a teacher, class or place"')
rep('aria-label="נקה חיפוש"', 'aria-label="Clear search"')
rep('aria-label="תצוגה"', 'aria-label="View"')
rep('aria-label="תצוגת רשימה" aria-pressed="true" title="רשימה"', 'aria-label="List view" aria-pressed="true" title="List"')
rep('aria-label="תצוגת לוח חודשי" aria-pressed="false" title="לוח חודשי"', 'aria-label="Month view" aria-pressed="false" title="Month"')
rep('aria-label="סינונים פעילים"', 'aria-label="Active filters"')
rep('aria-label="ימים קודמים" tabindex="-1" aria-hidden="true">→</button>', 'aria-label="Earlier days" tabindex="-1" aria-hidden="true">←</button>')
rep('aria-label="בחירת יום (אפשר גם עם החיצים במקלדת)"', 'aria-label="Choose a day (arrow keys work too)"')
rep('aria-label="ימים הבאים">←</button>', 'aria-label="Later days">→</button>')
rep('<b id="fsTitle">סינון אירועים</b>', '<b id="fsTitle">Filter events</b>')
rep('aria-label="סגירת הסינון"', 'aria-label="Close filters"')
rep('id="fsClear" type="button">נקה הכל</button>', 'id="fsClear" type="button">Clear all</button>')
rep('id="fsApply" type="button">הצג אירועים</button>', 'id="fsApply" type="button">Show events</button>')
rep('<h1 class="sr-only">zuzu — לוח אירועי תנועה וריקוד בישראל</h1>', '<h1 class="sr-only">zuzu — movement and dance events in Israel</h1>')
rep('aria-label="החודש הקודם"', 'aria-label="Previous month"')
rep('aria-label="החודש הבא"', 'aria-label="Next month"')
rep('aria-label="ימי החודש"', 'aria-label="Days of the month"')
# footer
a = s.find("<footer>"); b = s.find("</footer>", a)
if a < 0 or b < 0: sys.exit("build_en: footer not found")
s = s[:a] + ('<footer><div class="wrap">\n'
             '  <span class="fmark flist"><span>zuzu © 2026</span><span>·</span>'
             '<a href="/" class="footlink" style="text-decoration:none" lang="he" hreflang="he">zuzu בעברית</a><span>·</span>'
             '<a href="/" class="footlink" style="text-decoration:none">Add an event (Hebrew form)</a><span>·</span>'
             '<a href="/accessibility" class="footlink" style="text-decoration:none">Accessibility (Hebrew)</a></span>\n'
             '  <span class="fmark">Created with ❤️ by Dana Shimoni</span>\n'
             '</div></footer>') + s[b + len("</footer>"):]

# ---------- script: labels, dates, audience ----------
rep('const AUDIENCE_LABELS = {women_only:"נשים בלבד",men_only:"גברים בלבד",beginners_welcome:"מתאים למתחילים",\n'
    '                         parents_with_kids:"הורים וילדים",sixty_plus:"60+",partner_needed:"בזוגות"};',
    'const AUDIENCE_LABELS = {women_only:"Women only",men_only:"Men only",beginners_welcome:"Beginners welcome",\n'
    '                         parents_with_kids:"Parents & kids",sixty_plus:"60+",partner_needed:"With a partner"};')
rep('const HEB_DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];',
    'const HEB_DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];\n'
    'const SHORT_DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];\n'
    'const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];\n'
    'const evN = (n,pad) => (pad?String(n).padStart(2,"0"):String(n))+(n===1?" event":" events");')
rep('const HEB_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];',
    'const HEB_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];')
rep("  const base=`יום ${HEB_DAYS[dt.getDay()]} · ${dt.getDate()}.${dt.getMonth()+1}`;\n"
    "  if(diff===0) return '<span class=\"hot\">היום</span> · '+base;\n"
    "  if(diff===1) return \"מחר · \"+base;",
    "  const base=`${HEB_DAYS[dt.getDay()]} · ${dt.getDate()} ${SHORT_MONTHS[dt.getMonth()]}`;\n"
    "  if(diff===0) return '<span class=\"hot\">Today</span> · '+base;\n"
    "  if(diff===1) return \"Tomorrow · \"+base;")
rep('e.format||"שיעור"', 'e.format||"Class"', 3)
rep("encodeURIComponent('היי, ראיתי את \"'+(e.title||\"\")+'\" בזוזו ואשמח לפרטים 🙏')",
    "encodeURIComponent('Hi, I saw \"'+(e.title||\"\")+'\" on zuzu and would love more details 🙏')")
rep("const dateStr=`${HEB_DAYS[dd.getDay()]} ${dd.getDate()}.${dd.getMonth()+1}`;",
    "const dateStr=`${SHORT_DAYS[dd.getDay()]} ${dd.getDate()} ${SHORT_MONTHS[dd.getMonth()]}`;")
rep("'<span>כתבו בוואטסאפ</span>", "'<span>Message on WhatsApp</span>")
rep('`<span>${e.format==="הופעה/מופע"?"לפרטים ורכישה":"לפרטים והרשמה"}</span><span class="ar" aria-hidden="true">←</span>`',
    '`<span>${e.format==="Performance"?"Details & tickets":"Details & sign-up"}</span><span class="ar" aria-hidden="true">→</span>`')
rep("'<span class=\"nolink\">פרטים בקרוב</span>'", "'<span class=\"nolink\">Details soon</span>'")
rep('`<div class="host">עם <b>${e.host}</b></div>`', '`<div class="host">with <b>${e.host}</b></div>`')
rep('.filter(f=>f&&f!=="שיעור")', '.filter(f=>f&&f!=="Class")')
rep('aria-label="הוספת ${attrEsc(e.title)} ליומן גוגל"', 'aria-label="Add ${attrEsc(e.title)} to Google Calendar"')
rep("<span>יומן</span></button>", "<span>Calendar</span></button>")
rep('<span class="sr-only">: ${attrEsc(e.title)} (נפתח בחלון חדש)</span>', '<span class="sr-only">: ${attrEsc(e.title)} (opens in a new tab)</span>')
rep('const longFmt=["קורס","סדנה","ריטריט"].includes(ev.format);', 'const longFmt=["Course","Workshop","Retreat"].includes(ev.format);', 2)
rep('const desc=[ev.host?"עם "+ev.host:"",ev.url]', 'const desc=[ev.host?"with "+ev.host:"",ev.url]', 2)
rep("'<div class=\"empty\">אין אירועים בסינון הזה — נסו להרחיב את הבחירה ←</div>'", "'<div class=\"empty\">No events match these filters. Try widening them.</div>'")
rep('<span class="dc">${String(perDay[e.date]).padStart(2,"0")} אירועים</span>', '<span class="dc">${evN(perDay[e.date],true)}</span>', 3)
rep('`<span class="moreE">+${evs.length-3} נוספים</span>`', '`<span class="moreE">+${evs.length-3} more</span>`')
rep('const cellLbl=`${HEB_DAYS[cur.getDay()]} ${cur.getDate()} ב${HEB_MONTHS[cur.getMonth()]}, ${evs.length?evs.length+" אירועים":"אין אירועים"}`;',
    'const cellLbl=`${HEB_DAYS[cur.getDay()]} ${cur.getDate()} ${HEB_MONTHS[cur.getMonth()]}, ${evs.length?evN(evs.length):"no events"}`;')
rep("'<div class=\"empty\">אין אירועים ביום הזה</div>'", "'<div class=\"empty\">No events on this day</div>'")
rep("<span class=\"zspin\" aria-hidden=\"true\"></span>טוען אירועים…</div>", "<span class=\"zspin\" aria-hidden=\"true\"></span>Loading events…</div>")
rep("'<div class=\"empty zerr\" role=\"alert\">לא הצלחנו לטעון את האירועים כרגע. '", "'<div class=\"empty zerr\" role=\"alert\">We couldn\\'t load the events right now. '")
rep("id=\"zRetry\" class=\"tlNext\">נסו שוב →</button>", "id=\"zRetry\" class=\"tlNext\">Try again →</button>")
rep("  const full=`יום ${HEB_DAYS[dt.getDay()]} · ${dt.getDate()}.${dt.getMonth()+1}`;\n"
    "  if(diff===0) return [\"היום\", full, true];\n"
    "  if(diff===1) return [\"מחר\", full, false];\n"
    "  return [`יום ${HEB_DAYS[dt.getDay()]}`, `${dt.getDate()}.${dt.getMonth()+1}`, false];",
    "  const full=`${HEB_DAYS[dt.getDay()]} · ${dt.getDate()} ${SHORT_MONTHS[dt.getMonth()]}`;\n"
    "  if(diff===0) return [\"Today\", full, true];\n"
    "  if(diff===1) return [\"Tomorrow\", full, false];\n"
    "  return [HEB_DAYS[dt.getDay()], `${dt.getDate()} ${SHORT_MONTHS[dt.getMonth()]}`, false];")
rep("'<div class=\"empty\">לא נמצאו אירועים — נסו מילה אחרת ←</div>'", "'<div class=\"empty\">No events found. Try another word.</div>'")
rep("'<div class=\"empty\">אין אירועים השבוע.</div>'", "'<div class=\"empty\">No events this week.</div>'")
rep('const dowLabel = today ? "היום" : (diff===1 ? "מחר" : HEB_DAYS[d.getDay()]);',
    'const dowLabel = today ? "Today" : (diff===1 ? "Tmrw" : SHORT_DAYS[d.getDay()]);')
rep('const tickLbl=`${dowLabel==="היום"||dowLabel==="מחר"?dowLabel+", ":""}יום ${HEB_DAYS[d.getDay()]} ${d.getDate()} ב${HEB_MONTHS[d.getMonth()]}, ${c?c+" אירועים":"אין אירועים"}`;',
    'const tickLbl=`${today?"Today, ":diff===1?"Tomorrow, ":""}${HEB_DAYS[d.getDay()]} ${d.getDate()} ${HEB_MONTHS[d.getMonth()]}, ${c?evN(c):"no events"}`;')
rep('title="${c} אירועים"', 'title="${evN(c)}"')
rep('const subCount = window.ZUZU_LOADING ? "טוען…"\n'
    '                 : (dayEvs.length ? String(dayEvs.length).padStart(2,"0")+" אירועים" : "אין אירועים");',
    'const subCount = window.ZUZU_LOADING ? "Loading…"\n'
    '                 : (dayEvs.length ? evN(dayEvs.length,true) : "no events");')
rep('data-next="${nextKey}">לקפוץ ליום הקרוב עם אירועים →</button>', 'data-next="${nextKey}">Jump to the next day with events →</button>')
rep('`<div class="tlEmpty">אירועים רחוקים יותר — בתצוגת החודש או בחיפוש.</div>`', '`<div class="tlEmpty">Later events are in the month view or in search.</div>`')
rep('`<div class="tlEmpty">אין עוד אירועים בהמשך הלוח.</div>`', '`<div class="tlEmpty">No more events coming up.</div>`')
# arrow keys follow the reading direction: in English, → is the next day
rep('if(e.key==="ArrowLeft"){ e.preventDefault(); stepDay(1); }\n'
    '    else if(e.key==="ArrowRight"){ e.preventDefault(); stepDay(-1); }',
    'if(e.key==="ArrowRight"){ e.preventDefault(); stepDay(1); }\n'
    '    else if(e.key==="ArrowLeft"){ e.preventDefault(); stepDay(-1); }')
rep('const EVENT_FORMATS=["שיעור","ג\'אם","סדנה","קורס","ריטריט","מסיבת ריקוד","הופעה/מופע"];\n', "")
rep('const WHENS=[["tonight","היום"],["tomorrow","מחר"],["week","השבוע"],["all","הכל"]];',
    'const WHENS=[["tonight","Today"],["tomorrow","Tomorrow"],["week","This week"],["all","All"]];')
rep("MOVES=LOOKUPS.families.map(f=>f.label_he).filter(Boolean);", "MOVES=LOOKUPS.families.map(f=>f.label_en||f.label_he).filter(Boolean);")
rep("AREAS=LOOKUPS.regions.map(r=>r.name_he).filter(", "AREAS=LOOKUPS.regions.map(r=>r.name_en||r.name_he).filter(")
rep('b.setAttribute("aria-label","הסרת הסינון "+label);', 'b.setAttribute("aria-label","Remove filter "+label);')
rep('c.type="button"; c.textContent="נקה הכל";', 'c.type="button"; c.textContent="Clear all";')
rep('<span class="sr-only"> אירועים</span>', '<span class="sr-only"> events</span>', 3)
rep('body.innerHTML=grp("מתי",wp)+grp("אזור",ap)+grp("סוג תנועה",mp)+grp("סוג אירוע",fp);',
    'body.innerHTML=grp("When",wp)+grp("Area",ap)+grp("Movement",mp)+grp("Event type",fp);')
rep('sr.textContent=n?`, ${n} סינונים פעילים`:"";', 'sr.textContent=n?`, ${n} active filter${n===1?"":"s"}`:"";')
# data: English names from Supabase (label_en / name_en), Hebrew if one is missing.
# select=* so the page still loads before the English columns exist.
rep('region:safeTxt(region.name_he)', 'region:safeTxt(region.name_en||region.name_he)')
rep('(ev.location_on_registration?"המיקום יימסר בהרשמה":"")', '(ev.location_on_registration?"Location given on sign-up":"")')
rep('format:safeTxt(fmts[0]||"שיעור")', 'format:safeTxt(fmts[0]||"Class")')
rep("city:cities(name,region:regions(slug,name_he,sort_order))", "city:cities(name,region:regions(*))")
rep('sbGet("regions?select=slug,name_he,sort_order&order=sort_order"),', 'sbGet("regions?select=*&order=sort_order"),')
rep('sbGet("disciplines?select=slug,label_he"),', 'sbGet("disciplines?select=*"),')
rep('sbGet("families?select=slug,label_he,sort_order&order=sort_order"),', 'sbGet("families?select=*&order=sort_order"),')
rep('sbGet("formats?select=slug,label_he"),', 'sbGet("formats?select=*"),')
rep("discs.forEach(d=>LOOKUPS.discLabel[d.slug]=d.label_he);", "discs.forEach(d=>LOOKUPS.discLabel[d.slug]=d.label_en||d.label_he);")
rep("fmts.forEach(f=>LOOKUPS.fmtLabel[f.slug]=f.label_he);", "fmts.forEach(f=>LOOKUPS.fmtLabel[f.slug]=f.label_en||f.label_he);")
rep("fams.forEach(f=>LOOKUPS.famLabel[f.slug]=f.label_he);", "fams.forEach(f=>LOOKUPS.famLabel[f.slug]=f.label_en||f.label_he);")

rep('`<div class="host">with <b>${e.host}</b></div>`', '`<div class="host">with <b dir="auto">${e.host}</b></div>`')

# ---------- check: no Hebrew left outside the allowed spots ----------
allowed = ("lang=\"he\"", '"alternateName": "זוזו"',  # brand name
           '":"#')  # CAT_COLOR: unused colour table keyed by Hebrew style names
left = [ln.strip()[:100] for ln in s.splitlines()
        if re.search("[֐-׿]", ln) and not any(x in ln for x in allowed)
        and "/*" not in ln and "//" not in ln.split('"')[0]]
note = "<!-- Generated from index.html by v2/en/build_en.py. Edit index.html or the script, not this file. -->\n"
rep("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + note, 1)
open(DST, "w", encoding="utf-8").write(s)
if left:
    print("build_en: Hebrew still in en.html:")
    print("\n".join(left))
    sys.exit(1)
print("build_en: wrote en.html")
