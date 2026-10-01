# New feed leads — 2026-10-01

## Bad news first: nothing here is verified
This research ran in a cloud sandbox whose network blocks every outside site (WebFetch was `EGRESS_BLOCKED`; curl got a `403` from the proxy, even for example.com). Only web *search* worked. So:
- **No feed below has been tested.** The platform guesses come from URL patterns in search results. For example, `/event/<slug>/` and `/venue/<slug>/` are the default URL patterns of The Events Calendar (Tribe), and transliterated slugs suggest Wix.
- **To verify:** paste `docs/feed-probe.gs` into a new scratch Apps Script project (script.new), run `probeFeeds()`, and read the log. It only fetches; it writes nothing. A working Tribe site logs `JSON · tribe total=N first=<date> <title>`. A working iCal feed logs `ICS · N VEVENTs`.
- If the probe finds a working feed, add it to `TRIBE_SOURCES` (Tribe) or to the `feeds` sheet (iCal), as you already do.

About 35 candidates were checked.

## Best leads (test these first)

| # | Source | Why | What a hit means |
|---|---|---|---|
| 1 | **ecstaticdance.co.il** | You already scrape it weekly, and its URLs (`/event/…`, `/venue/…`) match Tribe's patterns. | You could **replace the scraper with the Tribe adapter**: more reliable, daily instead of weekly, and less custom code. |
| 2 | **ci-events.org** | The Israeli contact-improv events board (jams, classes, workshops nationwide). contactil.org appears to point to it. Its platform is unknown. | The biggest single CI source. If it's not Tribe/iCal, look for an embedded Google Calendar (the probe looks for one). |
| 3 | **naim.org.il (Studio Naim)** | Marked "Wix, not viable" in your to-do, but some URLs now look like WordPress (`/event/jam/`, `/event/contact-impro-tal/`). The site may have moved. | Worth one recheck: Naim is the "~1000 classes" source on your P2 list. |
| 4 | **hakvutza.org.il** (TLV) | WordPress; contact jam every Thursday plus the first Saturday of the month. Events look like posts, so probably not Tribe. | If not Tribe, the jam is simpler as a recurring hand-added slot. |
| 5 | **muslala.org** (Jerusalem) | WordPress `/events/` type; contact classes on the Klal Center roof. Mostly non-movement events. | Would need keyword filtering. |
| 6 | **pantarhei-studio.co.il** (Ginegar) | WordPress with custom `weekends`/`courses` types (somatic, contact weekends). | Probably free-text dates, so less clean. |

## Weaker leads (in the probe, lower value)
vertigo.org.il (jam on the 1st and last Saturday; probably pages, not a feed) · intimim.co.il (looks like Tribe, but mostly tantra and out of scope) · secrettelaviv.com · yoga.co.il · 5rhythms.com Israel directory (HTML, but the canonical 5Rhythms source) · biodanza.org.il weekly groups (HTML, recurring, not dated) · tederness.co.il (custom platform; the probe looks for JSON-LD `Event` data).

## coing
- coing.co organization pages follow `/<OrgSlug>/events`, `/<OrgSlug>/calendar` and `/<OrgSlug>/<id>` (for example [TLV_Magid_Nordaou_Studio](https://www.coing.co/TLV_Magid_Nordaou_Studio), a dance and movement space).
- **No public API or org-level iCal was found.** The per-event iCal mentioned in your checklist could not be confirmed from here.
- To check, open an org's `/events` page in Chrome with DevTools, go to Network → Fetch/XHR, and copy the JSON request. Also check the "add to calendar" link on one event. This is the "~1–2 hrs recon" item on your list, and it really does need a browser.
- Mostly Tel Aviv municipal community centers, so relevance is medium to low.

## Checked and not viable (from search evidence only)
- **Wix, no feed:** Studio Tena (very relevant; manual or scrape only), Kelim (festivals), Machol Shalem (performances), contactil.org (festival hub).
- **Ticketing with no public feed:** zygo, tickchak, Suzanne Dellal smarticket.
- **Static or stale:** contactimprov.com/israel.html.
- **Out of scope:** levdance (ballroom), iati.co.il (tech), basalon, kolsadna and similar marketplaces.
- **No public Israeli CI or ecstatic Google Calendars** turned up in search.

## Sources
Search-result URLs behind these claims are in the session report. The key ones:
[ci-events.org](https://www.ci-events.org/) ·
[ecstaticdance.co.il/venue/תל-אביב](https://ecstaticdance.co.il/venue/%D7%AA%D7%9C-%D7%90%D7%91%D7%99%D7%91/) ·
[naim.org.il/event/jam](https://www.naim.org.il/event/jam/) ·
[hakvutza contact-jam](https://www.hakvutza.org.il/en/contact-jam/) ·
[muslala event](https://muslala.org/events/%D7%A7%D7%95%D7%A0%D7%98%D7%A7%D7%98-%D7%90%D7%99%D7%9E%D7%A4%D7%A8%D7%95%D7%91%D7%99%D7%96%D7%A6%D7%99%D7%94-%D7%94%D7%9B%D7%A8%D7%95%D7%AA/) ·
[pantarhei weekends](https://pantarhei-studio.co.il/weekends/) ·
[studiotena](https://www.studiotena.org/event) ·
[5rhythms IL](https://www.5rhythms.com/EventSearch.php?event_country=IL&Type=1) ·
[biodanza.org.il](https://www.biodanza.org.il/dancer-activities.aspx?type=2) ·
[coing BatYam_Main/events](https://coing.co/BatYam_Main/events)
