// Claude extraction: free text → list of events in a fixed JSON shape.
// Structured outputs guarantee the shape; mapping.js still validates every value.
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5-5";

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const str = { type: "string" };
const enumOrNull = (values) => (values && values.length ? nullable({ type: "string", enum: values }) : nullable(str));
const enumArray = (values) => ({ type: "array", items: values && values.length ? { type: "string", enum: values } : str });

/** JSON schema for one extraction. Enums come from the live DB so the model can't invent slugs. */
export function buildSchema(lk) {
  const event = {
    type: "object",
    additionalProperties: false,
    required: [
      "title", "language", "description", "disciplines", "formats", "audience",
      "venue_name", "city", "location_on_registration", "hosts",
      "schedule", "price", "link", "phones", "parent_index", "notes", "source_quote",
    ],
    properties: {
      title: { type: "string", description: "Event title as the organizer would name it, without date/venue. Keep the source language." },
      language: { type: "string", enum: ["he", "en"] },
      description: nullable({ type: "string", description: "1–2 sentences from the text, or null." }),
      disciplines: enumArray(lk.disciplines.map((d) => d.slug)),
      formats: enumArray(lk.formats),
      audience: enumArray(lk.audience),
      venue_name: nullable({ type: "string", description: "Venue exactly as written (studio / place / address). null if not stated." }),
      city: nullable({ type: "string", description: "Town/city as written, or null." }),
      location_on_registration: { type: "boolean", description: "true only if the text says the location is given after registering." },
      hosts: {
        type: "array",
        description: "People or organizations leading it (e.g. after 'בהנחיית', 'עם', 'מנחה').",
        items: {
          type: "object", additionalProperties: false, required: ["name", "kind"],
          properties: { name: str, kind: enumOrNull(lk.hostKinds) },
        },
      },
      schedule: {
        type: "object", additionalProperties: false,
        required: ["kind", "date_start", "date_end", "weekdays", "interval_weeks", "sessions_count", "valid_until", "time_start", "time_end", "skip_dates"],
        properties: {
          kind: { type: "string", enum: ["once", "range", "weekly"], description: "once = single date; range = consecutive days (weekend/retreat/festival); weekly = repeats on weekdays (classes, courses)." },
          date_start: nullable({ type: "string", format: "date", description: "YYYY-MM-DD. For weekly: first meeting date if stated." }),
          date_end: nullable({ type: "string", format: "date", description: "Only for kind=range: last day." }),
          weekdays: { type: "array", items: { type: "integer" }, description: "For weekly: 0=Sunday … 6=Saturday. Several days at the same time = one event with several weekdays." },
          interval_weeks: nullable({ type: "integer", description: "1 = every week, 2 = every other week. Weekly only." }),
          sessions_count: nullable({ type: "integer", description: "Number of meetings if the text says so (e.g. '14 מפגשים')." }),
          valid_until: nullable({ type: "string", format: "date", description: "Last meeting date if explicitly stated. Leave null for ongoing classes." }),
          time_start: nullable({ type: "string", description: "HH:MM 24h" }),
          time_end: nullable({ type: "string", description: "HH:MM 24h" }),
          skip_dates: { type: "array", items: { type: "string", format: "date" }, description: "Dates the text says there is no meeting." },
        },
      },
      price: {
        type: "object", additionalProperties: false,
        required: ["raw", "kind", "min", "max", "unit"],
        properties: {
          raw: nullable({ type: "string", description: "Price text verbatim, all tiers (e.g. '80 ₪ / 70 ₪ מוקדם / כרטיסייה 600')." }),
          kind: enumOrNull(lk.priceKinds),
          min: nullable({ type: "number" }),
          max: nullable({ type: "number" }),
          unit: enumOrNull(lk.priceUnits),
        },
      },
      link: nullable({ type: "string", description: "Registration/info URL for THIS event, exactly as written." }),
      phones: { type: "array", items: str, description: "Contact phones for THIS event, as written, most relevant first." },
      parent_index: nullable({ type: "integer", description: "If this is a class inside a retreat/festival that is also listed, the 0-based index of that parent in events[]." }),
      notes: nullable({ type: "string", description: "Hebrew. Anything uncertain the reviewer should check (ambiguous date, guessed year, missing time)." }),
      source_quote: { type: "string", description: "The lines of the source text this event came from (max ~300 chars)." },
    },
  };
  return {
    type: "object", additionalProperties: false, required: ["events", "message_notes"],
    properties: {
      events: { type: "array", items: event },
      message_notes: nullable({ type: "string", description: "Hebrew. Anything about the whole message (e.g. 'no events found', 'shared phone for all')." }),
    },
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
  try { data = JSON.parse(textBlock.text); } catch { throw new Error("Claude returned invalid JSON"); }
  return { data, model: msg.model, usage: msg.usage, stop_reason: msg.stop_reason };
}
