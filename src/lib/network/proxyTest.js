import { ProxyAgent, undiciFetch } from "./undici.js";
import { SocksProxyAgent } from "socks-proxy-agent";
import https from "node:https";

// Socks health check via node:https + SocksProxyAgent. (SocksProxyAgent is an
// http.Agent, not an undici Dispatcher, and Bun fetch has no socks-capable
// proxy option — so socks pools are health-checked and managed, while
// provider traffic routing supports HTTP(S) pools only.)
function checkViaSocks(normalizedProxyUrl, normalizedTestUrl, timeoutMs, startedAt) {
  return new Promise((resolve) => {
    let agent;
    try {
      agent = new SocksProxyAgent(normalizedProxyUrl);
    } catch (err) {
      resolve({ ok: false, status: 400, error: `Invalid proxy URL: ${err?.message || String(err)}` });
      return;
    }
    const target = new URL(normalizedTestUrl);
    const timer = setTimeout(() => {
      try { req.destroy(new Error("Proxy test timed out")); } catch {}
    }, timeoutMs);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}` || "/",
        method: "HEAD",
        agent,
        headers: { "User-Agent": "9Router" },
      },
      (res) => {
        clearTimeout(timer);
        res.resume();
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          statusText: res.statusMessage || null,
          url: normalizedTestUrl,
          elapsedMs: Date.now() - startedAt,
        });
      },
    );
    req.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 500, error: getErrorMessage(err) });
    });
    req.on("timeout", () => {
      try { req.destroy(new Error("Proxy test timed out")); } catch {}
    });
    req.setTimeout(timeoutMs);
    req.end();
  });
}

const DEFAULT_TEST_URL = "https://google.com/";
const DEFAULT_TIMEOUT_MS = 8000;

function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export async function testProxyUrl({ proxyUrl, testUrl, timeoutMs } = {}) {
  const normalizedProxyUrl = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  const normalizedTestUrl = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    let scheme = "";
    try {
      scheme = new URL(normalizedProxyUrl).protocol;
    } catch {
      return { ok: false, status: 400, error: "Invalid proxy URL" };
    }
    // Socks goes through node:https (see checkViaSocks); undici ProxyAgent
    // is HTTP-only.
    if (scheme === "socks4:" || scheme === "socks5:" || scheme === "socks5h:" || scheme === "socks:") {
      return await checkViaSocks(normalizedProxyUrl, normalizedTestUrl, normalizedTimeoutMs, Date.now());
    }
    try {
      dispatcher = new ProxyAgent({ uri: normalizedProxyUrl });
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${err?.message || String(err)}`,
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "9Router",
        },
      });

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Proxy test timed out"
          : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      if (dispatcher && typeof dispatcher.close === "function") await dispatcher.close();
      else if (dispatcher && typeof dispatcher.destroy === "function") dispatcher.destroy();
    } catch {
      // ignore
    }
  }
}
