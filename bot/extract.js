// Claude extraction: free text → list of events in a fixed JSON shape.
// Structured outputs guarantee the shape; mapping.js still validates every value.
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5-5";

// No nullable/union types: the API allows at most 16 union-typed fields per schema, and each one adds
// compile cost. "Unknown" is sent as "" (strings) or -1 (numbers) and turned back into null by fromWire().
const str = (description) => (description ? { type: "string", description } : { type: "string" });
const num = (description) => ({ type: "number", description });
const int = (description) => ({ type: "integer", description });
const enumOrEmpty = (values, description) =>
  values && values.length ? { type: "string", enum: ["", ...values], description } : str(description);
const enumArray = (values) => ({ type: "array", items: values && values.length ? { type: "string", enum: values } : str() });
const obj = (properties, description) => ({
  type: "object", additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});
const DATE = "YYYY-MM-DD, or \"\" if not stated";

/** JSON schema for one extraction. Enums come from the live DB so the model can't invent slugs. */
export function buildSchema(lk) {
  const event = obj({
    title: str("Event title as the organizer would name it, without date/venue. Keep the source language."),
    language: { type: "string", enum: ["he", "en"] },
    description: str("1–2 sentences from the text, or \"\"."),
    disciplines: enumArray(lk.disciplines.map((d) => d.slug)),
    formats: enumArray(lk.formats),
    audience: enumArray(lk.audience),
    venue_name: str("Venue exactly as written (studio / place / address), or \"\" if not stated."),
    city: str("Town/city as written, or \"\"."),
    location_on_registration: { type: "boolean", description: "true only if the text says the location is given after registering." },
    hosts: {
      type: "array",
      description: "People or organizations leading it (e.g. after 'בהנחיית', 'עם', 'מנחה').",
      items: obj({ name: str(), kind: enumOrEmpty(lk.hostKinds, "\"\" if unsure") }),
    },
    schedule: obj({
      kind: { type: "string", enum: ["once", "range", "weekly"], description: "once = single date; range = consecutive days (weekend/retreat/festival); weekly = repeats on weekdays (classes, courses)." },
      date_start: str(`${DATE}. For weekly: first meeting date if stated.`),
      date_end: str(`${DATE}. Only for kind=range: last day.`),
      weekdays: { type: "array", items: { type: "integer" }, description: "For weekly: 0=Sunday … 6=Saturday. Several days at the same time = one event with several weekdays." },
      interval_weeks: int("Weekly only: 1 = every week, 2 = every other week. 1 if not weekly."),
      sessions_count: int("Number of meetings if the text says so (e.g. '14 מפגשים'), else 0."),
      valid_until: str(`${DATE}. Last meeting date only if explicitly stated; "" for ongoing classes.`),
      time_start: str("HH:MM 24h, or \"\""),
      time_end: str("HH:MM 24h, or \"\""),
      skip_dates: { type: "array", items: str("YYYY-MM-DD"), description: "Dates the text says there is no meeting." },
    }),
    price: obj({
      raw: str("Price text verbatim, all tiers (e.g. '80 ₪ / 70 ₪ מוקדם / כרטיסייה 600'), or \"\"."),
      kind: enumOrEmpty(lk.priceKinds, "\"\" if unsure"),
      min: num("Lowest per-person price, -1 if unknown, 0 if free."),
      max: num("Highest per-person price, -1 if unknown, 0 if free."),
      unit: enumOrEmpty(lk.priceUnits, "\"\" if unsure"),
    }),
    link: str("Registration/info URL for THIS event, exactly as written, or \"\"."),
    phones: { type: "array", items: str(), description: "Contact phones for THIS event, as written, most relevant first." },
    parent_index: int("If this is a class inside a retreat/festival that is also listed, the 0-based index of that parent in events[]; else -1."),
    notes: str("Hebrew. Anything uncertain the reviewer should check (ambiguous date, guessed year, missing time), or \"\"."),
    source_quote: str("The lines of the source text this event came from (max ~300 chars)."),
  });
  return obj({
    events: { type: "array", items: event },
    message_notes: str("Hebrew. Anything about the whole message (e.g. 'no events found', 'shared phone for all'), or \"\"."),
  });
}

/** Wire format ("" / -1 / 0 for unknown) → the internal shape the mapper expects (null for unknown). */
export function fromWire(data) {
  const s = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const n = (v) => (typeof v === "number" && v >= 0 ? v : null);
  return {
    message_notes: s(data.message_notes),
    events: (data.events || []).map((e) => ({
      ...e,
      description: s(e.description), venue_name: s(e.venue_name), city: s(e.city),
      link: s(e.link), notes: s(e.notes),
      hosts: (e.hosts || []).map((h) => ({ name: h.name, kind: s(h.kind) })),
      parent_index: Number.isInteger(e.parent_index) && e.parent_index >= 0 ? e.parent_index : null,
      schedule: {
        ...e.schedule,
        date_start: s(e.schedule?.date_start), date_end: s(e.schedule?.date_end), valid_until: s(e.schedule?.valid_until),
        time_start: s(e.schedule?.time_start), time_end: s(e.schedule?.time_end),
        interval_weeks: n(e.schedule?.interval_weeks) || null,
        sessions_count: n(e.schedule?.sessions_count) || null,
      },
      price: { raw: s(e.price?.raw), kind: s(e.price?.kind), min: n(e.price?.min), max: n(e.price?.max), unit: s(e.price?.unit) },
    })),
  };
}

export function buildSystemPrompt(lk, today) {
  const discs = lk.disciplines.map((d) => `${d.slug} = ${d.label_he}`).join("\n");
  return `You extract movement & dance events in Israel from forwarded text or screenshots (WhatsApp messages, newsletters, Facebook posts, posters) for zuzu.today, a curated calendar. A human reviews every event you return before it is published, so flag doubt in "notes" instead of guessing silently.

Today is ${today} (Asia/Jerusalem). Dates without a year are the next occurrence on or after today. Hebrew weekday names: ראשון=0 שני=1 שלישי=2 רביעי=3 חמישי=4 שישי=5 שבת=6.

Rules:
- One entry per distinct event. A message listing many classes/workshops gives many entries.
- A class that meets on several weekdays at the same time and place is ONE entry with several weekdays. Different times = separate entries.
- A course with N meetings: kind=weekly, date_start = first meeting, weekdays set, sessions_count = N. Don't compute the end date yourself unless the text states it.
- An ongoing weekly class without an end: kind=weekly, valid_until=null.
- A weekend/retreat on consecutive days: kind=range with date_start and date_end. If single classes inside it are sold separately, add the retreat AND each class, with parent_index pointing at the retreat.
- A free intro/open session announced separately from a course is its own once entry.
- Times are 24h HH:MM. "20:00-22:00" → time_start 20:00, time_end 22:00.
- Hosts: the people/organizations leading it ("בהנחיית", "עם", "מנחה"). Not the venue. Split "X ו-Y" into two hosts.
- venue_name: the studio/place exactly as written. A studio that sent the whole message is usually the venue for all its events unless stated otherwise. city: the town.
- price.raw keeps every tier verbatim. min/max are the lowest and highest per-person numbers. Leave kind/unit null if unsure.
- phones/link: copy exactly as written; the event's own contact first. A shared contact at the end of the message applies to all events.
- disciplines: pick from the list below only; choose the closest one or more. If nothing fits, return [] and say so in notes.
- Skip things that are not movement/dance events (ads, products, kids-only classes) and mention them in message_notes.
- If there are no events at all, return events: [] and explain in message_notes.

Disciplines (slug = Hebrew label):
${discs}`;
}

/**
 * Call Claude. Returns { data, model, usage, stop_reason }.
 * `revision` = { current, instruction } asks Claude to fix one previously extracted event.
 */
export async function extractEvents({ text, images = [], lookups, today, client, model, revision }) {
  client = client || new Anthropic();
  model = model || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const schema = buildSchema(lookups);
  const imageNote = images.length ? `(The source is ${images.length === 1 ? "the attached image" : `the ${images.length} attached images`} — a screenshot or poster; read the events from it. Any text below is the sender's caption.)\n` : "";
  const user = revision
    ? `${imageNote}Original forwarded text:\n<source>\n${text}\n</source>\n\nYou previously extracted this event:\n<event>\n${JSON.stringify(revision.current, null, 1)}\n</event>\n\nThe reviewer's correction (Hebrew, may be terse):\n<correction>\n${revision.instruction}\n</correction>\n\nReturn events: [the corrected event] — exactly one entry, all other fields unchanged unless the correction implies them.`
    : `${imageNote}<source>\n${text}\n</source>`;
  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: user },
  ];

  const params = {
    model,
    max_tokens: 32000,
    system: buildSystemPrompt(lookups, today),
    messages: [{ role: "user", content }],
    output_config: { effort: process.env.CLAUDE_EFFORT || "medium", format: { type: "json_schema", schema } },
    // Server-side fallback if the model declines; routed by refusal category.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  const stream = client.beta.messages.stream(params);
  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") throw new Error("Claude declined to process this text");
  if (msg.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens) — try forwarding a shorter part");
  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude returned no text block");
  let data;
  try { data = fromWire(JSON.parse(textBlock.text)); } catch { throw new Error("Claude returned invalid JSON"); }
  return { data, model: msg.model, usage: msg.usage, stop_reason: msg.stop_reason };
}
