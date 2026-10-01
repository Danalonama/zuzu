# zuzu v2 — the model (one page)

Built from Dana's answers in the Google Doc *zuzu-v2-data-model-questions.md* (last edited 26.9)
plus the decisions made in chat on 1.10. Where this page and the code disagree, the code is wrong.
The repo copy `docs/zuzu-v2-data-model-questions.md` is the unanswered version, kept for the record.

## Objects

| Object | Table | Notes |
|---|---|---|
| Event | `events` | One mechanism for everything (decided 1.10, replaces the separate "Series" in the Google Doc's C2): a date range, an optional weekly rule, optional children. |
| Host | `hosts` + `host_aliases` | Directory entry, person or org (B1). Several per event, or none (B3). A person can belong to an org. |
| Venue | `venues` + `venue_aliases` | Directory entry, kind ∈ studio / outdoor / online / disclosed_later / abroad (D4). |
| City → region | `cities`, `regions` | Region is derived from the venue's city, never entered (D5). |
| Source | `sources` | Per-source auto-publish flag (E2). New source = review-only. |
| Source record | `source_records` | Raw text + LLM extraction of every arrival, forever (E4). |
| Duplicate question | `duplicate_candidates` | "Same event?" for the bot (F2). Never re-asked once answered. |

## Event rules

- **Range / rule / children (C1+C2).** No rule + no children → shows every day of the range. `weekdays` restricts to those days. A child (class in a retreat, open session of a course) replaces the parent's card on its day. Skipped dates (חגים) = `skip_dates` on the parent.
- **Open-ended weekly classes (C3).** Get a 3-month horizon automatically (`open_ended = true`); the bot asks "still running?" 2 weeks before (`expiring_rules` view).
- **Special session in a series (C4).** A normal event.
- **Fields (D).** disciplines = set (D1) · formats = set (D2) · audience ⊂ {women_only, men_only, beginners, parents_kids, 60_plus} (D3; kids-only classes are out of scope, parents-with-kids are in) · time = real time, nullable (D6) · price = free text + optional min/max for stats (D7) · link must be a real URL, phone normalized to 05X-XXXXXXX (D8) · titles stored as written, `lang` he/en, no translation (D9) · events can be live with missing fields, flagged (D10).
- **Contact (B2).** Listing's own link/phone → else the host's → else the host's organization. The site gets `contact_source` so the reviewer can see which was used.
- **Statuses (G1).** draft · live · hidden (until a date) · past (automatic) · rejected · **merged** (added: a merged-away copy, kept so its key keeps resolving). Nothing is deleted (G3).
- **Freshness (G2).** `last_verified` moves on every save and every re-arrival; live events unverified for 60 days → `stale_live`.

## Identity & duplicates (F1–F3, agreed 1.10)

| Check | Rule | Result |
|---|---|---|
| Canonical key | date + normalized title + venue + start time | Same event. Merged silently. |
| Auto | same date + same start time + same venue + a shared host | Merged silently (exception to "never auto-merge", agreed 1.10). |
| Ask | same date + same start time + (same venue **or** a shared host) | Bot asks "same event?" |
| Ask | same date + (same venue **or** a shared host) + similar title, unless both start times are known and differ | Bot asks |

- **Start time is in the key** (my change, 1.10). Without it, Suzanne Dellal's Gaga 08:30 and Gaga 19:00 (same name, venue, day) would collide. A copy without a time is caught by the "ask" checks instead.
- **"Same date"** also includes a day that a weekly or range event runs on. Those matches are only ever asked about, never merged automatically.
- **Venue and host are compared by directory id.** Different spellings only match once the directory knows the alias. In v1's live data the auto rule finds 0 of the visible duplicates *by spelling*, because hosts and venues were spelled differently. The directory is what makes it work: answer once ("שירי" = שירי לוקש) and it merges by itself from then on.
- **Rejections stick to the key (E1).** A re-arrival is skipped and counted in `rejected_rearrivals` (weekly digest). A near-copy of a rejected event is asked about, not skipped.
- **Feed vs. your edits (E3).** Your edits win; a feed only fills blanks. Disagreements are stored on the source record (`conflicts`) so the bot can show them. Every key an event ever had keeps pointing at it, so a title you corrected doesn't come back as a new event.
- **Typos (E3 follow-up).** `learn_host_alias('איל בגר', <איל בנר>)`, and every future arrival is corrected.
- **Merging (F3).** Most-complete wins per field, sets union, `merge_preview()` shows the result before you confirm.

## Scope (H)

Kids: only parents/adults with kids · Abroad: in, from Israeli hosts, tagged, filter default "Israel only" · Ballroom / studio schools / Zumba: out for now · Online: in if Israeli and movement-related · Year-long programs: in if people can join mid-way.
These are review rules. The schema holds them (venue kinds, audience); the bot applies them.

## Still open

- **D5 region list.** Seeded with v1's 7 regions (tel_aviv, sharon, pardes_hana, center, jerusalem, north, south). Confirm or edit.
- **D10 channel.** How Zuzu nags you about incomplete / expiring / stale events: Telegram (planned) or an email digest.
- **E5 source order.** Proposed: Tribe/iCal → zuzu-inbox newsletters → bodyways (rebuilt) → ecstatic.
- **Vocabulary.** Discipline and format values are still v1's Hebrew words; English code names for them aren't decided (A1 only named the columns).
