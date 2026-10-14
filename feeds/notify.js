// Telegram summary of a feed run, to the owner(s). Short: one line per item that matters.
import { esc } from "../bot/card.js";

const NAMES = { deepcontact: "Deep Contact" };
const LIMIT = 3800; // Telegram allows 4096 characters

export function summary(report, error) {
  const name = NAMES[report?.source] || report?.source || "הזנה";
  if (error) return `⚠️ <b>${esc(name)}</b>: ההזנה נכשלה\n${esc(String(error.message || error)).slice(0, 500)}`;
  const head = report.dry_run
    ? `🧪 <b>${esc(name)}</b> — ריצת ניסיון, שום דבר לא נכתב לאתר`
    : `🛰️ <b>${esc(name)}</b>`;
  const line = (it) => {
    const what = [it.date_start, it.time, it.venue].filter(Boolean).join(" · ");
    if (it.action === "insert") return `➕ ${esc(it.title)}${what ? ` (${esc(what)})` : ""}`;
    if (it.action === "update") return `✏️ ${esc(it.site_title)}: השלמה של ${Object.keys(it.fill).join(", ")}`;
    if (it.action === "skip") return `⏸️ ${esc(it.source_title)} — ${esc(it.reason)}`;
    if (it.action === "error") return `❌ ${esc(it.source_title)} — ${esc(it.reason)}`;
    return null;
  };
  const diffs = report.items.filter((it) => it.diffs?.length)
    .map((it) => `🔍 ${esc(it.site_title)}: ${it.diffs.map((d) => `${d.field} באתר ${esc(JSON.stringify(d.site))}, במקור ${esc(JSON.stringify(d.source))}`).join("; ")}`);
  const unchanged = report.counts.unchanged ? [`✔️ ${report.counts.unchanged} כבר באתר, בלי שינוי`] : [];
  const verb = report.dry_run ? "היה מתווסף" : "נוסף";
  const lines = [head, `נמצאו ${report.fetched} פריטים. ${verb}: ${report.counts.insert || 0}.`, "",
    ...report.items.map(line).filter(Boolean), ...unchanged, ...(diffs.length ? ["", "הבדלים בין האתר למקור (לא שיניתי כלום):", ...diffs] : [])];
  let text = lines.join("\n");
  if (text.length > LIMIT) text = text.slice(0, LIMIT) + "\n…";
  return text;
}
