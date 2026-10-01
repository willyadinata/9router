// TUI catalog sync — v0.5.95 providers/models must exist in the static CLI lists.
// Pattern: source-text assertion (same as gemini-3x-integration tests), because
// cli/src/cli/menus/providers.js only exports showProvidersMenu.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tuiProviders = readFileSync(join(here, "../../cli/src/cli/menus/providers.js"), "utf8");
const modelSelector = readFileSync(join(here, "../../cli/src/cli/utils/modelSelector.js"), "utf8");

function block(source, key) {
  return source.match(new RegExp(`\\n  ${key}: \\[([\\s\\S]*?)\\n  \\],`))?.[1] || "";
}

describe("TUI catalog sync (v0.5.95)", () => {
  it("lists muse (OAuth) + v1m/agnes (API key) providers", () => {
    expect(tuiProviders).toContain('muse: { id: "muse"');
    expect(tuiProviders).toContain('v1m: { id: "v1m"');
    expect(tuiProviders).toContain('agnes: { id: "agnes"');
  });

  it("routes muse OAuth through device code flow", () => {
    expect(tuiProviders).toMatch(/DEVICE_CODE_PROVIDERS = \[[^\]]*"muse"[^\]]*\]/);
  });

  it("modelSelector knows the new provider aliases", () => {
    for (const alias of ['muse:', 'v1m:', 'agnes:']) {
      expect(modelSelector).toContain(alias);
    }
  });

  it("carries the new flagship models per alias", () => {
    expect(block(tuiProviders, "cc")).toContain("claude-sonnet-5-5");
    expect(block(tuiProviders, "cc")).toContain("claude-opus-5-5");
    expect(block(tuiProviders, "cx")).toContain("gpt-6.1-sol");
    expect(block(tuiProviders, "cx")).toContain("gpt-daybreak-blue-latest");
    expect(block(tuiProviders, "kr")).toContain("claude-opus-5.5");
    expect(block(tuiProviders, "muse")).toContain("muse-spark-1.3");
    expect(block(tuiProviders, "v1m")).toContain("rev-latest");
    expect(block(tuiProviders, "agnes")).toContain("agnes-3.0-flash");
  });

  it("new TUI model ids exist in the open-sse registry", () => {
    const ids = (file) =>
      [...readFileSync(join(here, "../../open-sse/providers/registry", file), "utf8")
        .matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]);
    const registry = new Set([
      ...ids("claude.js"), ...ids("codex.js"), ...ids("kiro.js"),
      ...ids("muse.js"), ...ids("v1m.js"), ...ids("agnes.js"),
    ]);
    // Only the v0.5.95 additions — pre-existing TUI entries are a curated
    // subset and intentionally not 1:1 with the registry.
    for (const id of [
      "claude-sonnet-5-5", "claude-opus-5-5", "gpt-6.1-sol",
      "gpt-daybreak-blue-latest", "claude-opus-5.5", "muse-spark-1.3",
      "rev-latest", "agnes-3.0-flash",
    ]) {
      expect(registry.has(id), `${id} missing from registry`).toBe(true);
    }
  });

  it("modelSelector module still loads", () => {
    const sel = require("../../cli/src/cli/utils/modelSelector.js");
    expect(typeof sel.selectModelFromList).toBe("function");
  });
});
