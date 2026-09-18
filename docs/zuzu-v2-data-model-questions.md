# zuzu v2 — data model decisions

*Every question below is a decision the store, the Telegram reviewer and the site all have to agree on. Each one has: why it matters (with a real example from the current sheet), the options, my recommendation, and a blank line for your decision. The recommendations are mine — the decisions are yours. Cross out anything you disagree with.*

*Fill this in, then the one-page model is mostly written.*

---

## A. Vocabulary (decide first — everything else uses these words)

**A1. What do we call things?**
Two separate vocabularies, decided separately:
- **Code name** — what the DB column, the API and the bot use. English, never shown to users, should not change once set.
- **Site label** — what the Hebrew site and the Telegram cards show. Can change any time without touching data.

Today the sheet has `category`, `type`, `teachers`, `host` with overlapping meanings. Pick one code word per concept and retire the rest. The "site today" column is what zuzu.today currently shows in its filters / add-event form (as of 15.9).

| Concept | Current code names | Proposed code name | Site today (HE) | Proposed site label (HE) |
|---|---|---|---|---|
| Movement practice (contact, gaga, ecstatic, biodanza…) | category, discipline | **discipline** | סוג תנועה | סוג תנועה |
| Format (class, jam, workshop, retreat, course, party) | type | **format** | סוג אירוע | סוג אירוע |
| Who leads it | host, teachers | **host** (see B1) | מנחה | מנחה / ארגון? (depends on B1) |
| Where — the place | venue | **venue** | מקום | מקום |
| Where — the town | city | (part of venue) | עיר / יישוב | עיר / יישוב |
| Where — the area | region | (derived from venue's city) | *(filter only — check label)* | אזור |
| Who it's for (women only, beginners, kids) | mixed into type/discipline | **audience** | *none — shown as an orange pill* | למי מתאים? / קהל? — needs a label |
| Registration link | url, link | **link** | קישור להרשמה | קישור להרשמה |
| Phone | phone | **phone** | טלפון / וואטסאפ | טלפון / וואטסאפ |

Two things to check on the site that I couldn't read from here: the exact label on the *region* filter, and whether the discipline filter and the add-form use the same wording.

Decision (code names): ______________________
Decision (site labels): ______________________

---

## B. Host

**B1. Is a host a person or an organization?**
Real cases: `Ruth Aharoni` teaches at `Deep Contact`; `שיעורים פתוחים - ורטיגו` is a program, not a person; `Movement Freaks` = Stas Kazanovitz; Suzanne Dellal Gaga has a monthly teacher rotation with no fixed host; `אילנית תדמור, לירון מיארה` is two people.
- Option 1: host = one free-text field (today). Cheap; typos forever; directory matching fails.
- Option 2: host = a person, organization is a separate optional field (`organizer`). Deep Contact events show "Ruth Aharoni · Deep Contact".
- Option 3: host = a directory entry that can be either a person or an org, with a `kind` flag.

Recommendation: **Option 3**, and an event can have *several* hosts. Directory entries hold phone/url/variants. This is what makes the phone auto-fill and kills the typos.

Decision: ______________________

**B2. Which contact wins when both host and organization have one?**
Deep Contact has a phone; Ruth Aharoni may have her own. The listing has one contact slot.
Recommendation: the listing's own explicit contact wins; else the host's; else the organization's. Reviewer shows which one was used.

Decision: ______________________

**B3. Can an event have no host?**
Suzanne Dellal 08:30 Gaga has no fixed teacher. Today `host=''` collapses the dedup key and merges unrelated events.
Recommendation: yes, allowed — but the dedup key never uses host (see F1), so an empty host is harmless.

Decision: ______________________

---

## C. What is an "event"? (the identity question)

**C1 + C2 — DECIDED (15.9): one mechanism — an event can have a range, a rule, and children.**

Dana's requirements:
- A course is one event, marked with its open/trial class, with its date range — **and it shows on every date the course meets**, because most teachers allow joining after a few sessions (experienced movers even later).
- A weekend retreat shows its range **and appears on every day it runs**, same text.
- Where a retreat sells single classes/days (Studio Tena style), the site should show the **specific classes**: "retreat name · class name with teacher · hours".

Model:
- `date_start` / `date_end` — the range. No rule + no children → the same card shows on every day in the range ("ריטריט … · 14–18.9").
- `rule` (weekday(s) + time, optional) — restricts which days in the range the event shows on. An 8-session Tuesday course shows on its eight Tuesdays. A rule with **no `date_end`** = the old "Series" (Suzanne Dellal grid, לנוע, TEO, Gohar). **Series is no longer a separate object.** `valid_until`-style expiry from C3 applies to any open-ended rule.
- `parent_id` (optional) — a child is a dated event that belongs to a parent (a class inside a retreat; a session inside a course; a monthly teacher override inside a weekly grid). On a day that has children, the site shows the children and hides the parent's generic card; otherwise it shows the parent.
- `open_session` (bool on a child) — "שיעור פתוח / ניסיון"; the parent course card can then say "אפשר להצטרף גם באמצע".

| Case | Range | Rule | Children |
|---|---|---|---|
| Weekend retreat, no per-class info | yes | no | none → parent shows every day |
| Studio Tena retreat with joinable classes | yes | no | one per class → children show |
| 8-session course, first is open | yes | weekly Tue 19:00 | one child flagged open_session |
| Suzanne Dellal weekly grid | open end | weekly ×15 slots | monthly teacher overrides |

Consequences to carry forward:
- **Reviewer/bot must make "belongs to" one tap** — paste a retreat program → bot proposes parent + children in one card.
- **F1 key for a child** = child's own date + title + venue (parent not in the key). If a feed sends the same class standalone, it merges into the child; the parent link is kept from whichever record had it (add to F3).
- **Site display rule** (index.html): for each visible day → events whose range covers the day ∧ (no rule ∨ rule matches weekday) ∧ (no children on that day); plus all children dated that day, labeled with the parent's name.
- Skipped dates (חגים) = an exception list on the parent, or a child with status `cancelled` — pick one in G1.

Old options kept for the record: Option 1 (start-date only), Option 2 (row per day), Option 3 (range + site decides). Decision = Option 3, extended with rule + children.

**C3. Does a series need an end date?**
Most studios run "until further notice". Without one, a dead class shows forever — the worst failure for a discovery site.
Recommendation: `valid_until` is required, default 3 months out; the bot reminds you 2 weeks before expiry ("still running?"). One tap extends.

Decision: ______________________

**C4. What about a special session inside a series?**
`שיעור גאגא וסשן חגיגי לפתיחת השנה` on 10.9 at Suzanne Dellal at 19:00 — it's not the 08:30 slot, but it's the same venue and discipline.
Recommendation: it's a normal event. A series occurrence and an event on the same date/time/venue are not dupes unless title matches (see F1).

Decision: ______________________

---

## D. Fields on an event

**D1. Disciplines — one or many?**
bodyways sends the same event once per discipline tag (`ביודנסה` and `מובמנט` for one class). The audit found this is the #1 dupe source (39 of 42 groups).
Recommendation: **a set**. Same key + different discipline = union, never a second event.

Decision: ______________________

**D2. Format — one or many?**
Already multi-value in v1 (chips). "שיעור + נשים בלבד" was two concepts jammed into one field.
Recommendation: format is a set, and audience is a separate set (see D3).

Decision: ______________________

**D3. Audience**
Today `נשים בלבד` / `גברים בלבד` live in either type or discipline. Kids events get rejected.
Recommendation: `audience` set: women-only, men-only, beginners-welcome, kids, 60+. Kids stays out of scope (rejected at review), unless you decide otherwise here.

Decision: ______________________

**D4. Location — how precise?**
Nature events and retreats disclose location only after registration (`location_disclosure` in the old to-do). Online events (`זום (אונליין)`). Events abroad (Paros, Orsolina28) — you rejected one as `לא בישראל` and then approved its twin.
- Venue is a directory entry (studio → city → region). Online is a venue. "Disclosed on registration" is a venue kind with a region only.
- Abroad: **in scope or not?** This is a product decision, not a data one, and it must be written down so the reviewer applies it consistently.

Recommendation: venue is always a directory entry with `kind` ∈ {studio, outdoor, online, disclosed-later, abroad}. Abroad: I'd allow it, tagged, with a filter default of "Israel only" — but you've rejected it once, so decide deliberately.

Decision (venue model): ______________________
Decision (abroad): ______________________

**D5. Region taxonomy**
Corrections show `פרדס חנה והסביבה` vs `שרון`, and `מרכז` used as a catch-all. Bat Yam → תל אביב. This needs a fixed list.
Recommendation: a short fixed list (~8 regions), and region is *derived from the venue's city*, never entered on the event.

Decision (list): ______________________

**D6. Time**
`8:30` vs `08:30` vs `1800` vs the `12/30/1899` epoch bug broke the dedup key in v1. Some events have no time ("details soon").
Recommendation: time is a real time type in the DB (Postgres `time`), nullable. `time_end` optional. The bot never accepts a free-text time — it parses and shows you what it understood.

Decision: ______________________

**D7. Price**
Free text today ("120", "תרומה", "לפי הרשמה"). Do you filter by it? If not, keep it free text.
Recommendation: free text, optional. Not worth structuring yet.

Decision: ______________________

**D8. Contact — link vs phone**
Old rule: link if there is one, else phone/WhatsApp. `url: "#"` was a frequent correction.
Recommendation: `link` (nullable, must be a valid URL — no `#`), `phone` (nullable, normalized to `05X-XXXXXXX`). Site shows link if present, else WhatsApp button from phone. Both come from the listing first, then the host directory (B2).

Decision: ______________________

**D9. Language**
Titles arrive in Hebrew and English (`GagaEden`, `Flying Low`, `DJ LIRAN`). Is there an English site? (Old to-do: needs a scope decision.)
Recommendation: store titles as-is, one language field per event (`he`/`en`). No translation in v2.

Decision: ______________________

**D10. "Details coming soon"**
Events that exist but have no venue/time/link yet (the thin Paros row).
Recommendation: an event can be live with missing fields, but the bot flags "incomplete" and re-asks you after 7 days. Alternatively: incomplete events aren't publishable. Your call — it's a quality-vs-coverage trade-off.

Decision: ______________________

---

## E. Sources & source records

**E1. Is a rejection permanent?**
The Paros retreat was rejected 22.8, then re-ingested 8.9 as a new row and approved. Today rejections are invisible to ingest.
Recommendation: rejection lives on the *source record* and on the *canonical key*. Anything arriving with a rejected key is auto-skipped, with a weekly digest "12 rejected re-arrivals" so you can un-reject.

Decision: ______________________

**E2. Which sources may auto-publish?**
v1: Tribe + iCal feeds publish live; ecstatic auto-approves; inbox/newsletters go to review.
Recommendation: same policy, but per-source and stored in a `sources` table (not code). New source = review-only until you flip it.

Decision: ______________________

**E3. When a feed re-sends an event you already edited, who wins?**
Example: you fix a host typo in the reviewer; tomorrow the feed sends the same event with the typo. Today: unclear.
- Option 1: feed always overwrites (your edits vanish).
- Option 2: manual edits win; feed can only fill blanks.
- Option 3: field-level: feed owns date/time/link, you own host/discipline/venue.

Recommendation: **Option 2** for v2. Field-level rules can come later if it hurts.

Decision: ______________________

**E4. What do we keep from the raw?**
The original newsletter paragraph / feed item / your paste.
Recommendation: keep the raw text and the LLM's extraction untouched on the source record, forever. Cheap, and it's how you debug "why did it extract that".

Decision: ______________________

**E5. Which v1 sources come to v2, and in what order?**
Tribe/iCal (hands-off) → zuzu-inbox newsletters → bodyways (with discipline union at the adapter) → ecstatic. Scrapers that fail ~30% (old `syncBodyways` timeout) get rebuilt or dropped, not ported.

Decision (order / drops): ______________________

---

## F. Identity & dedup (the one that hurt most)

**F1. What is the canonical key?**
Audit result: `date + normalized title` catches 42 dupe groups; `date + city + discipline` (v1) catches 1; `host + date + time` (v1 backend) misses on empty hosts and on `1800`/`18:00`.
Recommendation: `key = norm(date_start) + norm(title) + norm(venue or '')`, where norm = lowercase, strip punctuation/emoji/nikud, collapse whitespace, strip words like "שיעור", "עם", "ב-". Never host, never discipline, never time. Unique constraint in the DB.

Decision: ______________________

**F2. What counts as a near-duplicate, and what happens to it?**
Cross-source rewordings: bodyways *"שיעור קונטקט אימפרוביזציה בכליל"* vs newsletter *"קונטקט אימפרוביזציה עם נדב וטליה"*, same date.
Recommendation: same date + same venue *or* same host + title similarity above a threshold → the bot shows both and asks "same event?" with one tap to merge. Never auto-merge.

Decision: ______________________

**F3. When two records merge, whose fields become the event's?**
The thin Paros row vs the full one.
Recommendation: most-complete wins per field; disciplines union; `parent_id` kept from whichever record had one; you see the merged result before confirming.

Decision: ______________________

---

## G. Lifecycle

**G1. What statuses does an event have?**
Recommendation: `draft` (awaiting you) · `live` · `hidden` (suppressed until a date — the מעבר לגוף case) · `past` (auto, after date_end) · `rejected`.

Decision: ______________________

**G2. Freshness — when do we stop trusting an event?**
v1 store was 75% past-dated with no `last_verified`.
Recommendation: `last_verified` set on every save and on every feed re-arrival. Live events not verified in 60 days get a "still on?" nudge; series follow C3.

Decision: ______________________

**G3. What gets deleted, ever?**
Recommendation: nothing. Source records and events are kept; `past` and `rejected` are statuses. Storage is free; your rejection history is the future not-movement filter.

Decision: ______________________

---

## H. Product scope questions that leak into the model

These aren't data questions but the model can't be finished without answers.

- **H1.** Kids' classes — out (as now) or in with an audience tag?
- **H2.** Events abroad — see D4.
- **H3.** Ballroom / studio dance schools / fitness-adjacent (Zumba) — in or out? (bodyways sends some.)
- **H4.** Online-only events — in or out?
- **H5.** Year-long programs with no dates (rejected in v1) — out, or in as a "program" with a range?

Decisions: ______________________

---

*When these are filled in, the one-page model is: four objects (SourceRecord, Event — with optional range, rule, parent — Venue, Host), their fields per section D, the key from F1, the statuses from G1, and the rules from E1–E3. I'll write the schema from that page and nothing else.*
