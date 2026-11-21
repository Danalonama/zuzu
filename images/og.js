// Finds an event's promo image ("ad") on the organizer's page: og:image, then twitter:image,
// then <link rel="image_src">. Pure functions, no network, so they can be tested offline.

const META_RE = /<meta\b[^>]*>/gi;
const LINK_RE = /<link\b[^>]*>/gi;
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/g, '"').trim();

/** Returns the absolute image URL announced by the page, or null. */
export function findImage(html, pageUrl) {
  if (!html) return null;
  const head = html.slice(0, 300_000); // the tags live in <head>; don't scan huge bodies
  const metas = head.match(META_RE) || [];
  const pick = (keys) => {
    for (const key of keys) {
      for (const tag of metas) {
        const k = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
        if (k === key) { const c = attr(tag, "content"); if (c) return c; }
      }
    }
    return null;
  };
  let src = pick(["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
  if (!src) {
    for (const tag of head.match(LINK_RE) || []) {
      if ((attr(tag, "rel") || "").toLowerCase() === "image_src") { src = attr(tag, "href"); break; }
    }
  }
  return src ? absolute(decode(src), pageUrl) : null;
}

/** Only http(s) URLs to public-looking hosts; resolves relative paths against the page. */
export function absolute(src, base) {
  let u;
  try { u = new URL(src, base); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!isPublicHost(u.hostname)) return null;
  return u.href;
}

/** Rejects localhost, bare IPs in private ranges and internal names, so the function can't be
 *  pointed at the hosting network through a page's meta tags. */
export function isPublicHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || !h.includes(".") || h.endsWith(".local") || h.endsWith(".internal") || h === "localhost") return false;
  if (h.includes(":")) return false; // IPv6 literals: not needed for organizer sites
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  return true;
}

// Links that never carry an organizer's ad without a login, or are chat/forms/payment links.
const NO_AD_HOSTS = ["facebook.com", "fb.me", "instagram.com", "chat.whatsapp.com", "wa.me", "api.whatsapp.com",
  "forms.gle", "docs.google.com", "tally.so", "links.payboxapp.com", "payboxapp.com"];
export function worthFetching(link) {
  let u;
  try { u = new URL(link); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (!isPublicHost(h)) return false;
  return !NO_AD_HOSTS.some((x) => h === x || h.endsWith("." + x));
}
