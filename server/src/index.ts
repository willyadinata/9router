// 9Router Elysia backend entry — replaces Next.js server + custom-server.js.
// Run: PORT=20128 HOSTNAME=127.0.0.1 DATA_DIR=... bun run src/index.ts
import { randomBytes } from "node:crypto";
import { join, normalize, extname, sep } from "node:path";
import { Elysia } from "elysia";
import { dispatch, routeStats, stampRequest, runGuard } from "./dispatch";

// ---- per-process stamps (custom-server.js semantics) ----
const PEER_TOKEN = randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
process.env.NINEROUTER_MACHINE_ID ||= randomBytes(32).toString("hex");

// ---- server-side bootstrap (ports of layout.js side-effects + instrumentation.js) ----
await import("@/lib/network/initOutboundProxy");
await import("@/shared/services/bootstrap");
const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
initConsoleLogCapture();
const { initMachineId } = await import("@/shared/utils/machineId");
initMachineId();
const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
await installCatalogSource();
const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
startModelCatalogSync();
let stopBackgroundTokenRefresh = null;
let stopProxyAutoFetchFn = null;
try {
  const bg = await import("@/sse/services/backgroundTokenRefresh.js");
  bg.startBackgroundTokenRefresh();
  stopBackgroundTokenRefresh = bg.stopBackgroundTokenRefresh ?? null;
} catch (e) {
  console.error("[BackgroundTokenRefresh] start failed:", e?.message ?? e);
}
try {
  const { startProxyAutoFetch, stopProxyAutoFetch } = await import("@/sse/services/proxyAutoFetch.js");
  startProxyAutoFetch();
  stopProxyAutoFetchFn = stopProxyAutoFetch;
} catch (e) {
  console.error("[ProxyAutoFetch] start failed:", e?.message ?? e);
}

const PORT = Number(process.env.PORT || "20128");
const HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
const DIST = join(import.meta.dir, "..", "..", "web", "dist");

function clientIpOf(server: any, request: Request): string {
  try {
    const info = server?.requestIP?.(request);
    if (info?.address) return info.address;
  } catch {}
  return "";
}

function isApiPath(pathname: string) {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/v1" ||
    pathname.startsWith("/v1/") ||
    pathname === "/v1beta" ||
    pathname.startsWith("/v1beta/") ||
    pathname === "/codex" ||
    pathname.startsWith("/codex/") ||
    pathname === "/responses" ||
    pathname.startsWith("/responses/")
  );
}

const app = new Elysia()
  // API dispatch via onRequest short-circuit: Elysia's router prefers a
  // method-specific `.get("/*")` SPA fallback over `.all("/api/*")`, and
  // auto-handles OPTIONS before routing — both would bypass the ported
  // per-route handlers. Intercepting here preserves Next semantics exactly
  // (all methods, per-route OPTIONS, raw body).
  .onRequest(async ({ request, server }) => {
    const pathname = new URL(request.url).pathname;
    if (!isApiPath(pathname)) return;
    try {
      return await dispatch(request, { clientIp: clientIpOf(server, request) });
    } catch (e: any) {
      console.error("[api] dispatch failed:", e?.stack || e?.message || e);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  })
  .get("/*", async ({ request, server }) => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    // API paths that fell through keep JSON 404s — never the SPA shell.
    if (isApiPath(pathname)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    // Static assets bypass the page guard; missing ones 404 (no SPA fallback).
    const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    if (rel && !rel.includes("..") && extname(rel)) {
      const f = Bun.file(join(DIST, rel));
      if (await f.exists()) return new Response(f);
      return new Response("Not found", { status: 404 });
    }
    const distFile = Bun.file(join(DIST, "index.html"));
    if (!(await distFile.exists())) {
      return new Response("web/dist not built yet — run the frontend build first", { status: 503 });
    }
    // Pages go through the dashboard guard (middleware parity): unauthenticated
    // /dashboard redirects to /login instead of serving the shell.
    try {
      const stamped = stampRequest(request, clientIpOf(server, request));
      const guardRes = await runGuard(stamped);
      if (guardRes) return guardRes;
    } catch (e) {
      console.error("[spa] guard failed:", e?.message || e);
    }
    return new Response(distFile);
  });

app.listen({ port: PORT, hostname: HOSTNAME }, ({ port, hostname }) => {
  const s = routeStats();
  console.log(`[9router-elysia] listening on http://${hostname}:${port} (${s.files} route files, ${s.methods} handlers)`);
});

function shutdown() {
  try {
    stopBackgroundTokenRefresh?.();
  } catch {}
  try {
    stopProxyAutoFetchFn?.();
  } catch {}
  try {
    app.stop();
  } catch {}
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
