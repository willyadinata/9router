// Shim for `next/headers` — `cookies()` / `headers()` bound to the ambient
// request via AsyncLocalStorage. The dispatcher runs every route handler
// inside `runWithRequest()`, so copied handlers keep working unedited.
//
// Writes via the cookie store (`set`/`delete`) are collected in a per-request
// jar and merged onto the returned Response by the dispatcher — this mirrors
// Next, where `cookies().set()` in a route handler mutates the response.

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

export function runWithRequest(request, fn) {
  return store.run({ request, jar: [] }, fn);
}

function ctx() {
  const c = store.getStore();
  if (!c) throw new Error("cookies()/headers() called outside of a request context");
  return c;
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

class CookieStore {
  constructor(request, jar) {
    this._map = parseCookieHeader(request.headers.get("cookie"));
    this._jar = jar;
  }
  get(name) {
    if (name === undefined) {
      return [...this._map.entries()].map(([n, value]) => ({ name: n, value }));
    }
    if (!this._map.has(name)) return undefined;
    return { name, value: this._map.get(name) };
  }
  getAll(name) {
    const all = [...this._map.entries()].map(([n, value]) => ({ name: n, value }));
    return name === undefined ? all : all.filter((c) => c.name === name);
  }
  has(name) {
    return this._map.has(name);
  }
  set(name, value, opts) {
    this._jar.push(serializeSetCookie(name, value, opts));
  }
  delete(name, opts = {}) {
    this._jar.push(serializeSetCookie(name, "", { ...opts, maxAge: 0, expires: new Date(0) }));
  }
}

export async function cookies() {
  const { request, jar } = ctx();
  return new CookieStore(request, jar);
}

export async function headers() {
  return ctx().request.headers;
}

/** Drain Set-Cookie strings recorded via the store during this request. */
export function drainJar() {
  return ctx().jar.splice(0);
}
