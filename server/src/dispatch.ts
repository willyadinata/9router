// Central dispatcher: faithfully ports next.config.mjs rewrites + the
// src/app/api/**/route.js tree onto Elysia with { parse: "none" }.
//
// - Rewrite table is 1:1 with next.config.mjs (order matters, first match wins).
// - Route matching compiles each manifest nextPath to a regex:
//   [id] -> single segment, [...name] -> multi-segment array (like Next).
// - Handlers run inside next-headers ALS context; Set-Cookie recorded via
//   cookies().set()/delete() is merged onto the returned Response.
// - The dashboardGuard proxy() gate runs first with the same matcher as
//   proxy.js (everything except /_next/* and /favicon.ico).
import { ROUTES } from "./routes-manifest";
import { NextRequest, NextResponse, NEXT_NEXT } from "./shims/next-server";
import { runWithRequest, drainJar } from "./shims/next-headers";

// ---- rewrite table (ported 1:1 from next.config.mjs) ----
type Rewrite = { match: (p: string) => string | null };
const prefixTo = (from: string, to: string): Rewrite => ({
  match: (p) => (p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : null),
});
const exactTo = (from: string, to: string): Rewrite => ({
  match: (p) => (p === from ? to : null),
});
const REWRITES: Rewrite[] = [
  prefixTo("/v1/v1", "/api/v1"), // /v1/v1/:path* -> /api/v1/:path* (+ exact /v1/v1 -> /api/v1)
  prefixTo("/codex", "/api/v1/responses"), // /codex/:path* -> /api/v1/responses (prefix absorbs subpath)
  exactTo("/responses", "/api/v1/responses"),
  prefixTo("/v1beta", "/api/v1beta"),
  prefixTo("/v1", "/api/v1"),
];

export function applyRewrites(pathname: string): string {
  for (const r of REWRITES) {
    const out = r.match(pathname);
    if (out !== null) return out;
  }
  return pathname;
}

// ---- route table ----
function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Compiled {
  file: string;
  nextPath: string;
  methods: Set<string>;
  regex: RegExp;
  paramNames: { name: string; catchAll: boolean }[];
}

function compile(nextPath: string, file: string, methods: string[]): Compiled {
  const paramNames: { name: string; catchAll: boolean }[] = [];
  const parts = nextPath.split("/").map((seg) => {
    const m = /^\[(\.\.\.)?([^\]]+)\]$/.exec(seg);
    if (!m) return escapeReg(seg);
    paramNames.push({ name: m[2], catchAll: Boolean(m[1]) });
    return m[1] ? "(.+)" : "([^/]+)";
  });
  return { file, nextPath, methods: new Set(methods), regex: new RegExp("^" + parts.join("/") + "/?$"), paramNames };
}

const TABLE: Compiled[] = ROUTES.map((r) => compile(r.nextPath, r.file, r.methods));
const STATIC = new Map<string, Compiled>();
for (const c of TABLE) {
  if (c.paramNames.length === 0) STATIC.set(c.nextPath, c);
}

const moduleCache = new Map<string, any>();
async function loadModule(file: string) {
  let m = moduleCache.get(file);
  if (!m) {
    m = await import(file);
    moduleCache.set(file, m);
  }
  return m;
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function mergeJarCookies(res: Response) {
  let jar: string[] = [];
  try {
    jar = drainJar();
  } catch {
    /* no ALS context — nothing recorded */
  }
  if (jar.length === 0) return res;
  const headers = new Headers(res.headers);
  for (const c of jar) headers.append("set-cookie", c);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ---- guard (dashboardGuard.js proxy, same matcher as proxy.js) ----
function guardApplies(pathname: string) {
  if (pathname.startsWith("/_next/")) return false;
  if (pathname === "/favicon.ico") return false;
  return true;
}

let guardMod: any = null;
async function loadGuard() {
  if (!guardMod) guardMod = await import("../vendor/dashboardGuard.js");
  return guardMod;
}
export async function runGuard(request: NextRequest): Promise<Response | null> {
  const guard = await loadGuard();
  if (!guardApplies(new URL(request.url).pathname)) return null;
  const out = await guard.proxy(request);
  if (out && (out as any)[NEXT_NEXT]) return null; // NextResponse.next() -> continue
  return out ?? null;
}

// ---- xiaomi mimo login proxy branch (parity with src/proxy.js) ----
// The Next middleware (src/proxy.js) is dead on Elysia — dispatch replaces it.
// This ports its mimo branch 1:1: session state rides the httpOnly
// 9r_mimo_login cookie; the branch requires dashboard auth so a forged
// cookie never turns the app into an unauthenticated forwarder.
let mimoMod: any = null;
async function loadMimo() {
  // Live src/ copy, NOT vendored: zero next/* imports (runs on the shimmed
  // NextRequest), and its relative open-sse imports only resolve from src/lib/.
  if (!mimoMod) mimoMod = await import("../../src/lib/mimoLoginSession.js");
  return mimoMod;
}

function withClearedMimoSession(res: Response, sessionCookie: string): Response {
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Returns a Response when the mimo branch handles the request, else null. */
export async function runMimoLoginProxy(request: NextRequest): Promise<Response | null> {
  const mimo = await loadMimo();
  const cookies = request.headers.get("cookie") || "";
  if (!cookies.includes(`${mimo.SESSION_COOKIE}=`)) return null;
  const guard = await loadGuard();
  const url = new URL(request.url);
  if (!(await guard.isAuthenticated(request))) {
    // Forged or stale session cookie without dashboard auth — drop it early.
    return withClearedMimoSession(await guard.proxy(request), mimo.SESSION_COOKIE);
  }
  const sess = mimo.sessionFromRequest(request);
  if (sess) {
    const origin = mimo.originOf(request);
    try {
      if (mimo.isMimoTakeoverPath(url.pathname)) {
        const upstreamUrl = `${sess.upstreamBase}${mimo.takeoverUpstreamPath(url.pathname)}${url.search || ""}`;
        return mimo.attachSessionCookie(await mimo.runTakeover(sess, upstreamUrl, origin), sess);
      }
      if (mimo.isAccountProxyPath(url.pathname)) {
        return mimo.attachSessionCookie(await mimo.proxyAccountRequest(sess, request, origin), sess);
      }
    } catch (e: any) {
      console.log(`${new Date().toISOString().slice(11, 23)} [mimo-login] proxy error:`, e?.message || e);
      return new Response("mimo login proxy error", { status: 502 });
    }
  }
  // Cookie present but expired/invalid — clear it on the way past.
  return withClearedMimoSession(await guard.proxy(request), mimo.SESSION_COOKIE);
}

// ---- main entry ----
export interface DispatchOpts {
  clientIp: string; // unspoofable TCP peer address from the socket
}

export function stampRequest(original: Request, clientIp: string): NextRequest {
  // Stamp peer headers (custom-server.js semantics): derive client IP from the
  // TCP socket, trust forwarding headers only from a loopback reverse proxy.
  const xff = original.headers.get("x-forwarded-for");
  const xRealIp = original.headers.get("x-real-ip");
  const viaProxy = Boolean(xff || xRealIp);
  const socketIp = clientIp || "";
  const isLoopbackProxy =
    socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
  const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
  const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;

  const headers = new Headers(original.headers);
  headers.delete("x-9r-real-ip");
  headers.delete("x-forwarded-for");
  headers.delete("x-9r-via-proxy");
  headers.delete("x-9r-peer-token");
  headers.set("x-9r-real-ip", ip);
  headers.set("x-9r-peer-token", process.env.NINEROUTER_PEER_TOKEN || "");
  if (viaProxy) headers.set("x-9r-via-proxy", "1");

  return new NextRequest(original, { headers });
}

export async function dispatch(original: Request, opts: DispatchOpts): Promise<Response> {
  const url = new URL(original.url);
  const internalPath = applyRewrites(url.pathname);

  const request = stampRequest(original, opts.clientIp);

  return runWithRequest(request, async () => {
    const mimoRes = await runMimoLoginProxy(request);
    if (mimoRes) return mergeJarCookies(mimoRes);

    const guardRes = await runGuard(request);
    if (guardRes) return mergeJarCookies(guardRes);

    const method = original.method.toUpperCase();
    let compiled = STATIC.get(internalPath) ?? null;
    let params: Record<string, string | string[]> = {};
    if (!compiled) {
      for (const c of TABLE) {
        const m = c.regex.exec(internalPath);
        if (!m) continue;
        compiled = c;
        c.paramNames.forEach((p, i) => {
          const raw = m[i + 1] ?? "";
          params[p.name] = p.catchAll
            ? raw.split("/").filter(Boolean).map(safeDecode)
            : safeDecode(raw);
        });
        break;
      }
    }
    if (!compiled) return jsonError(404, `Not found: ${internalPath}`);
    if (!compiled.methods.has(method)) {
      return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), {
        status: 405,
        headers: {
          "content-type": "application/json",
          allow: [...compiled.methods].join(", "),
        },
      });
    }

    const mod = await loadModule(compiled.file);
    const fn = mod[method];
    if (typeof fn !== "function") return jsonError(405, `Method ${method} not allowed`);

    // `await params` works on plain objects, matching Next's async-params contract.
    const out = await fn(request, { params });
    if (out instanceof Response) return mergeJarCookies(out);
    if (out && (out as any)[NEXT_NEXT]) return jsonError(500, "Guard pass-through leaked into route");
    return mergeJarCookies(NextResponse.json(out ?? null));
  });
}

export function routeStats() {
  return { files: TABLE.length, methods: TABLE.reduce((n, c) => n + c.methods.size, 0) };
}
