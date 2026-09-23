// Scheduled free-proxy fetch-and-merge. Runs the same job as the manual
// "Fetch Free Proxies" button on a timer, controlled by settings:
//   proxyAutoFetch: { enabled, intervalHours, limit, protocols, sourceUrl,
//                     lastRunAt, lastSummary }
// Fail-open: tick errors never kill the interval. A 60s base tick checks
// due-ness, so toggling settings takes effect without restart or re-arming.
import { getSettings, updateSettings } from "@/lib/localDb";
import { getFetchJob, hasRunningFetchJob, startFetchJob, DEFAULT_SOURCE_URL } from "@/app/api/proxy-pools/fetch/jobs.js";

const TICK_MS = 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;
const DEFAULT_INTERVAL_HOURS = 6;

let started = false;
let timerHandle = null;
let tickRunning = false;

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isDue(settings, nowMs = Date.now()) {
  const cfg = settings?.proxyAutoFetch;
  if (!cfg || cfg.enabled !== true) return false;
  const intervalMs = toPositiveNumber(cfg.intervalHours, DEFAULT_INTERVAL_HOURS) * 3600 * 1000;
  const last = cfg.lastRunAt ? Date.parse(cfg.lastRunAt) : NaN;
  if (!Number.isFinite(last)) return true; // never ran -> due
  return nowMs - last >= intervalMs;
}

function readConfig(settings) {
  const cfg = settings?.proxyAutoFetch || {};
  const protocols = Array.isArray(cfg.protocols) && cfg.protocols.length > 0 ? cfg.protocols : undefined;
  return {
    sourceUrl: typeof cfg.sourceUrl === "string" && cfg.sourceUrl.trim() ? cfg.sourceUrl.trim() : DEFAULT_SOURCE_URL,
    limit: Math.min(Math.max(Math.floor(Number(cfg.limit)) || 200, 1), 1000),
    protocols,
  };
}

// One tick body. Exported for tests; the interval calls it every TICK_MS.
export async function checkProxyAutoFetch(nowMs = Date.now()) {
  if (tickRunning) return { ran: false, reason: "overlap" };
  tickRunning = true;
  try {
    const settings = await getSettings().catch(() => null);
    if (!settings) return { ran: false, reason: "no-settings" };
    if (!isDue(settings, nowMs)) return { ran: false, reason: "not-due" };
    if (hasRunningFetchJob()) return { ran: false, reason: "job-running" };
    const { sourceUrl, limit, protocols } = readConfig(settings);
    const job = startFetchJob({ sourceUrl, limit, timeoutMs: 8000, concurrency: 20, protocols });
    await waitForJob(job.jobId);
    const finished = getFetchJob(job.jobId);
    const summary = finished?.result
      ? `+${finished.result.added} added, ${finished.result.keptAlive} kept, ${finished.result.removedDead} dead removed`
      : finished?.error || "unknown";
    const cfg = settings.proxyAutoFetch || {};
    await updateSettings({
      proxyAutoFetch: { ...cfg, lastRunAt: new Date().toISOString(), lastSummary: summary },
    }).catch(() => {});
    return { ran: true, jobId: job.jobId, summary };
  } catch (error) {
    console.warn("[ProxyAutoFetch] tick failed:", error?.message || error);
    return { ran: false, reason: "error" };
  } finally {
    tickRunning = false;
  }
}

function waitForJob(jobId, timeoutMs = 30 * 60 * 1000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      const job = getFetchJob(jobId);
      if (!job || job.done || Date.now() - startedAt > timeoutMs) {
        clearInterval(poll);
        resolve();
      }
    }, 2000);
    if (poll.unref) poll.unref();
  });
}

export function startProxyAutoFetch() {
  if (started) return;
  if (typeof window !== "undefined") return;
  started = true;
  const safeTick = () => {
    checkProxyAutoFetch().catch(() => {});
  };
  setTimeout(safeTick, INITIAL_DELAY_MS);
  timerHandle = setInterval(safeTick, TICK_MS);
  if (timerHandle.unref) timerHandle.unref();
  console.log("[ProxyAutoFetch] scheduler started (tick 60s)");
}

export function stopProxyAutoFetch() {
  started = false;
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}
