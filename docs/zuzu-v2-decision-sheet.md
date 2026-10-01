# zuzu v2 — decision sheet (fast pass)

*Companion to `zuzu-v2-data-model-questions.md` (2026-10-01). That doc has the reasoning; this one makes the decision session ~20 minutes. Nothing here is decided — every line is a **default you accept or strike**. When you've gone through it, copy your answers into the `Decision:` lines of the main doc.*

**How to read each row**
- **Default** = the recommendation already in the main doc (unless marked ⚠ — then I'm proposing a change and say why).
- **Cost to change later** = how painful it is to reverse after v2 has data. **High** = decide carefully now. **Low** = accept the default and move on.
- **Blocks** = what can't be built until this is answered.

---

## 1. Decide these first — they block the schema (High cost to change)

| # | Question | Default | Cost to change later | Blocks | ✔ / ✘ |
|---|---|---|---|---|---|
| A1 | Code names | `discipline`, `format`, `host`, `venue`, `audience`, `link`, `phone` | **High** — column names spread into API, bot, site | everything | |
| F1 | Canonical key | ⚠ `date + norm(title) + norm(venue)` **+ time when both sides have one** (see issue 1 below) | **High** — it's a unique constraint; changing it means re-deduping the whole store | DB, import, every adapter | |
| B1 | Host = person or org? | Directory entry with `kind` (person/org); an event can have several hosts | **High** — free text → directory later = a cleanup project | host directory, phone auto-fill | |
| G1 | Statuses | `draft · live · hidden · past · rejected` (+ `cancelled` if you pick it for skipped dates — see issue 4) | **High** — every query filters on it | site read endpoint, bot | |
| D1 | Disciplines one or many | **Set**; same key + different discipline = union | **High** — set↔single is a schema change | bodyways adapter, filters | |
| D4a | Venue model | Directory entry, `kind` ∈ studio / outdoor / online / disclosed-later / abroad | **High** | region derivation (D5), F1 (venue is in the key) | |

## 2. Decide soon — medium cost

| # | Question | Default | Cost to change later | Blocks | ✔ / ✘ |
|---|---|---|---|---|---|
| C3 | Series end date | ⚠ Required `date_end` on any rule, default +3 months, bot nudges 2 weeks before (see issue 2 — don't add a separate `valid_until`) | Medium | series import (Suzanne Dellal, לנוע, TEO, Gohar) | |
| D2 | Format one or many | Set | Medium | — | |
| D3 | Audience | Separate set: women-only, men-only, beginners-welcome, 60+ (kids: see H1) | Medium | filters, the orange pill | |
| D6 | Time | Postgres `time`, nullable; `time_end` optional; bot never accepts free text | Medium (data cleanup if you go free-text) | F1 if you take the ⚠ version | |
| D8 | Link vs phone | `link` nullable valid URL (no `#`); `phone` normalized `05X-XXXXXXX`; site: link else WhatsApp | Low–Medium | — | |
| E2 | Auto-publish | Per-source flag in a `sources` table; new source = review-only until flipped | Low | adapters | |
| E3 | Feed re-sends an edited event | Option 2: your edits win; feed only fills blanks | Medium — needs per-field "edited by you" tracking from day 1 to be reversible | adapters, import | |
| E4 | Keep raw | Keep raw text + LLM extraction forever on the source record | **High if you say no** (it's gone) — Low if yes | — | |
| F2 | Near-duplicates | Same date + (same venue or same host) + similar title → bot asks "same event?" — never auto-merge | Low | bot | |
| F3 | Merge winner | Most-complete per field; disciplines union; keep `parent_id` | Low | — | |
| G2 | Freshness | `last_verified` on every save/re-arrival; "still on?" nudge after 60 days | Low (but add the column now) | — | |
| E1 | Rejection permanent? | Stored on source record + key; re-arrivals auto-skipped; weekly digest | Low | — | |

## 3. Product calls — need you, not data reasoning

| # | Question | Default | Note | ✔ / ✘ |
|---|---|---|---|---|
| H1 | Kids' classes | Out (as now) | If "in", add `kids` to D3 | |
| H2 / D4b | Events abroad | Allowed, tagged `abroad`, filter default "Israel only" | You rejected Paros once and approved its twin — pick one rule | |
| H3 | Ballroom / dance schools / Zumba | Out | bodyways sends some; the reviewer needs a written rule | |
| H4 | Online-only | Allowed as venue kind `online` | | |
| H5 | Year-long programs with no dates | Out | If "in", they're a range with no rule — C1 already supports it | |
| D10 | "Details coming soon" | Live with missing fields, flagged, re-asked after 7 days | Coverage vs. quality | |
| D9 | Language | Store as-is, `lang` field, no translation | Depends on the English-site scope decision | |

## 4. Low-stakes — accept unless you object

| # | Question | Default | ✔ / ✘ |
|---|---|---|---|
| B2 | Which contact wins | Listing → host → org; reviewer shows which | |
| B3 | Event with no host | Allowed (host is not in the key) | |
| C4 | Special session inside a series | Normal event | |
| D5 | Region | Fixed list (~8), derived from venue city — **list still needs writing** | |
| D7 | Price | Free text, optional | |
| E5 | Source order | Tribe/iCal → inbox newsletters → bodyways (discipline union at adapter) → ecstatic; rebuild-or-drop scrapers that fail ~30% | |
| G3 | Deletions | Never; `past`/`rejected` are statuses | |

---

## Issues I found in the current recommendations

**1. F1 as written ("never time") merges real separate classes — fix before deciding.**
Evidence: `setupSuzanneDellalGaga()` (`apps-script/zuzu-events.gs:1433-1447`) has up to **three same-title slots at the same venue on one day** (e.g. Monday 08:30, 18:30, 20:45 — all "Gaga" at Suzanne Dellal). gagapeople.com's Tribe feed sends instances the same way. Under `date + title + venue`, these collapse into one row, and with a unique constraint the 2nd and 3rd are rejected on insert.
Why "never time" was recommended: v1 broke on `1800` vs `18:00`. That's a parsing problem, which D6 fixes (real `time` type).
Proposed: `key = date + norm(title) + norm(venue) + (time if known else '')`, **and** F2's near-dup pass treats "same date/title/venue, one side has no time" as a candidate to ask about. Trade-off: a feed that changes an event's time creates a second row instead of updating — F2 catches it, but it's one more tap for you. I don't know how often feeds change times; the v1 sheet history could answer that.

**2. C3 `valid_until` duplicates C1's `date_end`.**
C1 says "rule with no `date_end` = series". C3 then adds `valid_until`. Two fields for "when does this stop" will drift. Proposed: one field — `date_end` required on any rule, defaulting to +3 months, and "extend" just moves it.

**3. F1's title normalization can empty a title.** Stripping "שיעור", "עם", "ב-" helps matching, but a generic title like "שיעור" normalizes to an empty string, so every such class on that date/venue would share a key. Proposed: if the normalized title is shorter than ~3 characters, fall back to the raw title.

**4. G1 vs C1 skipped dates.** C1 left "exception list on the parent vs `cancelled` child" open and pointed at G1, but G1's list has no `cancelled`. Either add `cancelled` to G1 or choose the exception list explicitly.

**5. E1 + F1 interact.** Rejections are stored on the key, and the key is normalized. A rejected event's key can silently block a different event that normalizes to the same date/title/venue. Low risk with venue + time in the key; higher without. Another reason to resolve issue 1 first.

---

## Suggested order for the session (~20 min)
1. Section 1 (6 decisions) — these are the ones that matter. Resolve issue 1 while doing F1.
2. Section 3 product calls — fast, they're opinions.
3. Skim sections 2 and 4, strike only what you disagree with.
4. Write the region list (D5) — that one needs actual content.

When section 1 is done, the schema can be written without guessing.
