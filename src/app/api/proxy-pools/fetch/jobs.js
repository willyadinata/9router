// Async fetch-and-merge jobs for free proxy lists (e.g. ProxyScrape).
// In-memory per process (the gateway runs a single Bun process).
// Merge semantics: saved proxies are re-checked — dead ones are deleted
// (disabled when bound to a connection), live ones are kept untouched;
// new proxies that pass the health check are appended as pools.
import { randomUUID } from "node:crypto";
import {
  createProxyPool,
  deleteProxyPool,
  getProviderConnections,
  getProxyPoolById,
  getProxyPools,
  updateProxyPool,
} from "@/models";
import { testProxyUrl } from "@/lib/network/proxyTest";

export const DEFAULT_SOURCE_URL =
  "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text";

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;
export const DEFAULT_CONCURRENCY = 20;
export const MAX_CONCURRENCY = 50;
const DOWNLOAD_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// Schemes the health check supports: HTTP(S) via undici ProxyAgent,
// socks via SocksProxyAgent. Anything else is counted as skipped.
const SUPPORTED_SCHEMES = new Set(["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"]);

const jobs = new Map();
const MAX_JOBS = 20;

function boundCount(connections, poolId) {
  let n = 0;
  for (const c of connections) {
    if (c?.providerSpecificData?.proxyPoolId === poolId) n += 1;
  }
  return n;
}

function normalizeCandidate(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!SUPPORTED_SCHEMES.has(url.protocol)) return { skipped: true };
  if (!url.hostname || !url.port) return null;
  const normalized = `${url.protocol}//${url.hostname.toLowerCase()}:${url.port}`;
  return { url: normalized, host: url.hostname.toLowerCase(), port: url.port };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function downloadList(sourceUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(sourceUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`Source responded with status ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new Error("Source list exceeds 5MB, refusing to parse");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function getFetchJob(jobId) {
  return jobs.get(jobId) || null;
}

export function hasRunningFetchJob() {
  for (const job of jobs.values()) {
    if (!job.done) return true;
  }
  return false;
}

function pruneJobs() {
  while (jobs.size >= MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    jobs.delete(oldest);
  }
}

export function startFetchJob({ sourceUrl, limit, timeoutMs, concurrency, protocols }) {
  pruneJobs();
  const jobId = randomUUID();
  const job = {
    jobId,
    phase: "starting",
    total: 0,
    checked: 0,
    alive: 0,
    done: false,
    error: null,
    result: null,
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  runJob(job, { sourceUrl, limit, timeoutMs, concurrency, protocols }).catch((error) => {
    job.done = true;
    job.error = error?.message || String(error);
  });
  return job;
}

async function runWithConcurrency(items, limit, fn, onEach) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
      if (onEach) onEach();
    }
  });
  await Promise.all(workers);
}

async function runJob(job, { sourceUrl, limit, timeoutMs, concurrency, protocols }) {
  const now = () => new Date().toISOString();
  const wanted = Array.isArray(protocols) && protocols.length > 0
    ? new Set(protocols.map((p) => String(p).toLowerCase().replace(/:$/, "") + ":"))
    : null;
  job.phase = "downloading";
  const text = await downloadList(sourceUrl);

  const seen = new Set();
  const candidates = [];
  let invalid = 0;
  let skippedUnsupported = 0;
  for (const line of text.split(/\r?\n/)) {
    const parsed = normalizeCandidate(line);
    if (!parsed) {
      if (String(line || "").trim()) invalid += 1;
      continue;
    }
    if (parsed.skipped) {
      skippedUnsupported += 1;
      continue;
    }
    if (wanted && !wanted.has(new URL(parsed.url).protocol)) {
      skippedUnsupported += 1;
      continue;
    }
    if (seen.has(parsed.url)) continue;
    seen.add(parsed.url);
    candidates.push(parsed);
  }

  shuffleInPlace(candidates);
  const fresh = candidates.slice(0, limit);

  const pools = await getProxyPools({});
  // Re-check URL-based pools (http + socks). Relay types (vercel/cloudflare/
  // deno) use a different test and are left untouched.
  const checkPools = pools.filter((p) => ["http", "socks"].includes(p.type || "http"));
  const existingKeys = new Set(
    checkPools.map((p) => String(p.proxyUrl || "").trim().toLowerCase()).filter(Boolean),
  );

  const connections = await getProviderConnections();
  const toCheck = fresh.filter((c) => !existingKeys.has(c.url.toLowerCase()));

  job.total = checkPools.length + toCheck.length;
  job.checked = 0;
  job.alive = 0;

  const result = {
    sourceUrl,
    fetchedLines: text.split(/\r?\n/).filter((l) => l.trim()).length,
    candidates: fresh.length,
    invalid,
    skippedUnsupported,
    added: 0,
    keptAlive: 0,
    removedDead: 0,
    disabledBound: 0,
    failed: 0,
  };

  const bump = () => {
    job.checked += 1;
  };

  // Phase 1: re-check saved pools. Dead ones are deleted (disabled when
  // bound to a connection); live ones are kept untouched apart from a
  // refreshed testStatus.
  job.phase = "checking-saved";
  await runWithConcurrency(
    checkPools,
    concurrency,
    async (pool) => {
      try {
        const check = await testProxyUrl({ proxyUrl: pool.proxyUrl, timeoutMs });
        if (check.ok) {
          job.alive += 1;
          result.keptAlive += 1;
          await updateProxyPool(pool.id, { testStatus: "active", lastTestedAt: now(), lastError: null });
        } else if (boundCount(connections, pool.id) > 0) {
          result.disabledBound += 1;
          await updateProxyPool(pool.id, {
            testStatus: "error",
            lastTestedAt: now(),
            lastError: check.error || "Proxy test failed",
            isActive: false,
          });
        } else {
          result.removedDead += 1;
          await deleteProxyPool(pool.id);
        }
      } catch {
        result.failed += 1;
      }
    },
    bump,
  );

  // Phase 2: health-check fresh candidates (excluding ones already saved —
  // those were covered in phase 1) and append the survivors as pools.
  job.phase = "checking-new";
  await runWithConcurrency(
    toCheck,
    concurrency,
    async (cand) => {
      try {
        const check = await testProxyUrl({ proxyUrl: cand.url, timeoutMs });
        if (check.ok) {
          job.alive += 1;
          const scheme = new URL(cand.url).protocol;
          const created = await createProxyPool({
            name: `Imported ${cand.host}:${cand.port}`,
            proxyUrl: cand.url,
            noProxy: "",
            isActive: true,
            strictProxy: false,
            type: scheme.startsWith("socks") ? "socks" : "http",
            testStatus: "active",
            lastTestedAt: now(),
          });
          if (created) result.added += 1;
          else result.failed += 1;
        }
      } catch {
        result.failed += 1;
      }
    },
    bump,
  );

  job.phase = "done";
  job.done = true;
  job.result = result;
}
