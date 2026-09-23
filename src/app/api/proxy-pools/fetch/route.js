import { NextResponse } from "next/server";
import {
  DEFAULT_LIMIT,
  DEFAULT_CONCURRENCY,
  DEFAULT_SOURCE_URL,
  MAX_CONCURRENCY,
  MAX_LIMIT,
  startFetchJob,
} from "./jobs.js";

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

// POST /api/proxy-pools/fetch - Start a free-proxy fetch-and-merge job.
// Body: { sourceUrl?, limit?, timeoutMs?, concurrency? }
// Saved http pools are re-checked (dead ones deleted, live ones kept);
// fresh proxies that pass the health check are appended as pools.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    const sourceUrl = typeof body?.sourceUrl === "string" && body.sourceUrl.trim()
      ? body.sourceUrl.trim()
      : DEFAULT_SOURCE_URL;
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json({ error: "sourceUrl must be an http(s) URL" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "sourceUrl is not a valid URL" }, { status: 400 });
    }

    const limit = Math.min(toPositiveInt(body?.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const concurrency = Math.min(toPositiveInt(body?.concurrency, DEFAULT_CONCURRENCY), MAX_CONCURRENCY);

    const SUPPORTED_PROTOCOLS = ["http", "https", "socks", "socks4", "socks5", "socks5h"];
    let protocols = null;
    if (body?.protocols !== undefined) {
      if (!Array.isArray(body.protocols) || body.protocols.length === 0) {
        return NextResponse.json({ error: "protocols must be a non-empty array" }, { status: 400 });
      }
      protocols = body.protocols.map((p) => String(p).toLowerCase().replace(/:$/, ""));
      const bad = protocols.filter((p) => !SUPPORTED_PROTOCOLS.includes(p));
      if (bad.length > 0) {
        return NextResponse.json({ error: `Unsupported protocols: ${bad.join(", ")}` }, { status: 400 });
      }
    }
    const timeoutRaw = Number(body?.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.min(Math.floor(timeoutRaw), 30000)
      : 8000;

    const job = startFetchJob({ sourceUrl, limit, timeoutMs, concurrency, protocols });
    return NextResponse.json({
      jobId: job.jobId,
      statusUrl: `/api/proxy-pools/fetch/${job.jobId}`,
      message: "Fetch job started",
    }, { status: 202 });
  } catch (error) {
    console.log("Error starting proxy fetch job:", error);
    return NextResponse.json({ error: "Failed to start fetch job" }, { status: 500 });
  }
}
