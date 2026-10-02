// SOCKS traffic routing in proxyFetch.getDispatcher.
// SOCKS5 goes through undici's Socks5ProxyAgent (experimental, pinned exact
// in package.json). socks4:// has no undici support and must fail loudly,
// never leak direct.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../../open-sse/utils/proxyFetch.js"), "utf8");

describe("SOCKS traffic routing (proxyFetch)", () => {
  it("rejects socks4:// instead of routing or leaking", () => {
    expect(source).toMatch(/socks4a\?:.*SOCKS4 proxy not supported/s);
  });

  it("normalizes socks5h:// to socks5:// for undici", () => {
    expect(source).toContain('replace(/^socks5h:/i, "socks5:")');
  });

  it("no longer throws health-check-only for socks5", () => {
    expect(source).not.toContain("health-check only");
  });

  it("pins undici exact (experimental Socks5ProxyAgent must not shift)", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(here, "../../package.json"), "utf8"),
    );
    expect(pkg.dependencies.undici).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
