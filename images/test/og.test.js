import { test } from "node:test";
import assert from "node:assert/strict";
import { findImage, absolute, isPublicHost, worthFetching } from "../og.js";
import handler from "../../api/event-image.js";

test("og:image wins, in either attribute order and quote style", () => {
  const html = `<head><meta content='/img/ad.jpg' property='og:image'><meta name="twitter:image" content="https://x.example/t.jpg"></head>`;
  assert.equal(findImage(html, "https://studio.example/event/1"), "https://studio.example/img/ad.jpg");
});

test("falls back to twitter:image, then link rel=image_src", () => {
  assert.equal(findImage(`<meta name="twitter:image" content="https://cdn.example/t.png">`, "https://a.example/"), "https://cdn.example/t.png");
  assert.equal(findImage(`<link rel="image_src" href="//cdn.example/s.jpg">`, "https://a.example/"), "https://cdn.example/s.jpg");
  assert.equal(findImage(`<title>no image</title>`, "https://a.example/"), null);
});

test("decodes &amp; in the URL", () => {
  assert.equal(findImage(`<meta property="og:image" content="https://cdn.example/i.jpg?w=1200&amp;h=630">`, "https://a.example/"),
    "https://cdn.example/i.jpg?w=1200&h=630");
});

test("refuses non-http schemes and internal hosts", () => {
  assert.equal(absolute("javascript:alert(1)", "https://a.example/"), null);
  assert.equal(absolute("data:image/png;base64,xx", "https://a.example/"), null);
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.1.1", "169.254.169.254", "metadata.internal", "intranet"]) {
    assert.equal(isPublicHost(h), false, h);
  }
  assert.equal(isPublicHost("studiotamara.co.il"), true);
});

test("skips links that never carry an ad (Facebook, WhatsApp, forms, payment)", () => {
  for (const l of ["https://www.facebook.com/events/1", "https://chat.whatsapp.com/abc", "https://forms.gle/x", "https://links.payboxapp.com/x", "mailto:a@b.c"]) {
    assert.equal(worthFetching(l), false, l);
  }
  assert.equal(worthFetching("https://www.gagapeople.com/he/class/1"), true);
});

// --- the Vercel function, with a fake network ---
function fakeRes() {
  const r = { headers: {}, code: 0, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.end = () => r; r.send = (b) => { r.body = b; return r; };
  return r;
}
const streamOf = (buf) => (async function* () { yield buf; })();
function fakeFetch(map) {
  return async (url) => {
    const hit = Object.entries(map).find(([k]) => url.startsWith(k));
    if (!hit) return { ok: false, status: 404, headers: new Map(), body: null };
    const [, v] = hit;
    if (v.json) return { ok: true, json: async () => v.json };
    const buf = Buffer.from(v.body);
    return { ok: true, url, headers: new Map([["content-type", v.type], ["content-length", String(buf.length)]]), body: streamOf(buf) };
  };
}

test("returns the organizer's og:image and caches it for a week", async () => {
  const res = fakeRes();
  await handler({ query: { id: "11111111-2222-3333-4444-555555555555" } }, res, { fetchImpl: fakeFetch({
    "https://eiseowpkwexktqrtoeaq.supabase.co/rest/v1/events": { json: [{ link: "https://studio.example/ev" }] },
    "https://studio.example/ev": { type: "text/html", body: `<meta property="og:image" content="/ad.jpg">` },
    "https://studio.example/ad.jpg": { type: "image/jpeg", body: "JPEGDATA" },
  }) });
  assert.equal(res.code, 200);
  assert.equal(res.headers["content-type"], "image/jpeg");
  assert.match(res.headers["cache-control"], /s-maxage=604800/);
  assert.equal(String(res.body), "JPEGDATA");
});

test("404 without fetching anything for a Facebook link or a bad id", async () => {
  let calls = 0;
  const f = fakeFetch({ "https://eiseowpkwexktqrtoeaq.supabase.co/rest/v1/events": { json: [{ link: "https://www.facebook.com/events/9" }] } });
  const res = fakeRes();
  await handler({ query: { id: "11111111-2222-3333-4444-555555555555" } }, res, { fetchImpl: (u, o) => { calls++; return f(u, o); } });
  assert.equal(res.code, 404); assert.equal(calls, 1);
  const bad = fakeRes();
  await handler({ query: { id: "../../etc" } }, bad, { fetchImpl: () => { throw new Error("must not fetch"); } });
  assert.equal(bad.code, 404);
});

test("404 when the 'image' is not an image", async () => {
  const res = fakeRes();
  await handler({ query: { id: "11111111-2222-3333-4444-555555555555" } }, res, { fetchImpl: fakeFetch({
    "https://eiseowpkwexktqrtoeaq.supabase.co/rest/v1/events": { json: [{ link: "https://studio.example/ev" }] },
    "https://studio.example/ev": { type: "text/html", body: `<meta property="og:image" content="/x">` },
    "https://studio.example/x": { type: "text/html", body: "<html>" },
  }) });
  assert.equal(res.code, 404);
});
