// Shim for `next/server` — lets copied Next route handlers run unedited on Elysia.
// Only the surface the 9router API routes actually use is implemented:
// NextResponse.json / constructor passthrough / redirect / next().

export const NEXT_NEXT = Symbol.for("9router.nextNext");

function parseCookieHeader(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name && !out.has(name)) {
      try {
        out.set(name, decodeURIComponent(value));
      } catch {
        out.set(name, value);
      }
    }
  }
  return out;
}

export class RequestCookies {
  constructor(headers) {
    this._map = parseCookieHeader(headers?.get?.("cookie"));
  }
  get(name) {
    if (!this._map.has(name)) return undefined;
    return { name, value: this._map.get(name) };
  }
  getAll() {
    return [...this._map.entries()].map(([name, value]) => ({ name, value }));
  }
  has(name) {
    return this._map.has(name);
  }
}

export class NextRequest extends Request {
  get nextUrl() {
    return new URL(this.url);
  }
  get cookies() {
    return new RequestCookies(this.headers);
  }
}

function serializeSetCookie(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value ?? "")}`;
  if (opts.maxAge != null) s += `; Max-Age=${opts.maxAge}`;
  if (opts.expires) s += `; Expires=${opts.expires instanceof Date ? opts.expires.toUTCString() : opts.expires}`;
  if (opts.path) s += `; Path=${opts.path}`;
  if (opts.domain) s += `; Domain=${opts.domain}`;
  if (opts.sameSite) s += `; SameSite=${opts.sameSite}`;
  if (opts.httpOnly) s += `; HttpOnly`;
  if (opts.secure) s += `; Secure`;
  return s;
}

export class ResponseCookies {
  constructor(response) {
    this._response = response;
  }
  set(name, value, opts) {
    this._response.headers.append("set-cookie", serializeSetCookie(name, value, opts));
  }
  delete(name, opts = {}) {
    this._response.headers.append(
      "set-cookie",
      serializeSetCookie(name, "", { ...opts, maxAge: 0, expires: new Date(0) }),
    );
  }
  get() {
    return undefined;
  }
}

export class NextResponse extends Response {
  static json(data, init?) {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(data), { ...init, headers });
  }
  static redirect(url, status = 307) {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
  /** Middleware/guard "continue" signal — the dispatcher treats it as pass-through. */
  static next() {
    const res = new NextResponse(null, { status: 200 });
    res[NEXT_NEXT] = true;
    return res;
  }
  get cookies() {
    return new ResponseCookies(this);
  }
}

export default { NextRequest, NextResponse };
