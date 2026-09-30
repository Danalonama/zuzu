// Minimal PostgREST client with the service_role key (server-side only — never ship this key to a browser).

export class SupabaseError extends Error {
  constructor(status, body, path) {
    super(`supabase ${status} ${path}: ${body?.message || JSON.stringify(body)}`);
    this.status = status; this.code = body?.code; this.body = body;
  }
}

export function createSupabase({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = fetch } = {}) {
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const base = url.replace(/\/$/, "") + "/rest/v1/";
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  async function req(method, path, { body, prefer, range } = {}) {
    const h = { ...headers };
    if (prefer) h.Prefer = prefer;
    if (range) { h["Range-Unit"] = "items"; h.Range = range; }
    const r = await fetchImpl(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new SupabaseError(r.status, data, `${method} ${path}`);
    return data;
  }

  return {
    get: (path) => req("GET", path),
    /** GET every row, paging past PostgREST's max-rows limit. */
    async all(path, page = 1000) {
      const out = [];
      for (let from = 0; ; from += page) {
        const rows = await req("GET", path, { range: `${from}-${from + page - 1}` });
        out.push(...rows);
        if (rows.length < page) return out;
      }
    },
    insert: (table, rows, { returning = true } = {}) =>
      req("POST", table, { body: rows, prefer: returning ? "return=representation" : "return=minimal" }),
    update: (pathWithFilter, patch) => req("PATCH", pathWithFilter, { body: patch, prefer: "return=representation" }),
    del: (pathWithFilter) => req("DELETE", pathWithFilter, { prefer: "return=minimal" }),
    rpc: (fn, args) => req("POST", `rpc/${fn}`, { body: args || {} }),
  };
}

export const inList = (ids) => `in.(${ids.map((x) => `"${String(x).replace(/"/g, "")}"`).join(",")})`;
