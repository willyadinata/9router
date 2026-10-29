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

describe("TUI catalog sync (v0.5.99)", () => {
  it("lists minimax-code (OAuth) + bedrock/bedrock-xai (API key) providers", () => {
    expect(tuiProviders).toContain('"minimax-code": { id: "minimax-code"');
    expect(tuiProviders).toContain('bedrock: { id: "bedrock"');
    expect(tuiProviders).toContain('"bedrock-xai": { id: "bedrock-xai"');
  });

  it("modelSelector knows the new provider aliases", () => {
    for (const alias of ['mm:', 'bedrock:', '"bedrock-xai":']) {
      expect(modelSelector).toContain(alias);
    }
  });

  it("carries the new flagship models per alias", () => {
    expect(block(tuiProviders, "mm")).toContain("MiniMax-M3");
    expect(block(tuiProviders, "bedrock")).toContain("us.anthropic.claude-sonnet-5");
    expect(block(tuiProviders, '"bedrock-xai"')).toContain("us.xai.grok-4.6");
  });

  it("new TUI model ids exist in the open-sse registry", () => {
    const ids = (file) =>
      [...readFileSync(join(here, "../../open-sse/providers/registry", file), "utf8")
        .matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]);
    const registry = new Set([
      ...ids("minimax-code.js"), ...ids("bedrock.js"), ...ids("bedrock-xai.js"),
    ]);
    for (const id of [
      "MiniMax-M3", "us.anthropic.claude-sonnet-5", "us.xai.grok-4.6",
    ]) {
      expect(registry.has(id), `${id} missing from registry`).toBe(true);
    }
  });
});

describe("TUI catalog sync (v0.5.104)", () => {
  it("lists nous (OAuth device-flow + API key) provider", () => {
    expect(tuiProviders).toContain('nous: { id: "nous"');
  });

  it("routes nous OAuth through device code flow", () => {
    expect(tuiProviders).toMatch(/DEVICE_CODE_PROVIDERS = \[[^\]]*"nous"[^\]]*\]/);
  });

  it("modelSelector knows the nous alias", () => {
    expect(modelSelector).toContain('nous:');
  });

  it("carries the new flagship models per alias", () => {
    expect(block(tuiProviders, "nous")).toContain("meituan/longcat-2.0:free");
    expect(block(tuiProviders, "nous")).toContain("stealth/missingno");
    expect(block(tuiProviders, "gemini")).toContain("gemini-4-argon");
    expect(block(tuiProviders, "ag")).toContain("gemini-4-argon-high");
  });

  it("new TUI model ids exist in the open-sse registry", () => {
    // Nous formats entries across lines (`{\n id:`) so match bare `id:` here.
    const ids = (file) =>
      [...readFileSync(join(here, "../../open-sse/providers/registry", file), "utf8")
        .matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
    const registry = new Set([
      ...ids("nous.js"), ...ids("gemini.js"), ...ids("antigravity.js"),
    ]);
    for (const id of [
      "meituan/longcat-2.0:free", "stealth/missingno",
      "gemini-4-argon", "gemini-4-argon-high",
    ]) {
      expect(registry.has(id), `${id} missing from registry`).toBe(true);
    }
  });
});

describe("TUI catalog sync (v0.5.112)", () => {
  it("lists nace (API key) under its nace alias", () => {
    expect(tuiProviders).toContain('nace: { id: "nace", alias: "nace"');
  });

  it("modelSelector knows the nace alias", () => {
    expect(modelSelector).toContain('nace: "Nace Drex"');
    expect(modelSelector).toContain('nace: "nace"');
  });

  it("carries the new flagship models per alias", () => {
    expect(block(tuiProviders, "nace")).toContain("drex-max");
    expect(block(tuiProviders, "nace")).toContain("drex-v2.0");
    expect(block(tuiProviders, "cx")).toContain("gpt-6.1-terra");
  });

  it("new TUI model ids exist in the open-sse registry", () => {
    const ids = (file) =>
      [...readFileSync(join(here, "../../open-sse/providers/registry", file), "utf8")
        .matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]);
    const registry = new Set([...ids("nace.js"), ...ids("codex.js")]);
    for (const id of ["drex-max", "drex-v2.0", "gpt-6.1-terra"]) {
      expect(registry.has(id), `${id} missing from registry`).toBe(true);
    }
  });
});

describe("TUI catalog sync (v0.5.111)", () => {
  it("lists runcrate (API key) under its rc alias", () => {
    expect(tuiProviders).toContain('runcrate: { id: "runcrate", alias: "rc"');
  });

  it("modelSelector knows the rc alias", () => {
    expect(modelSelector).toContain('rc: "Runcrate"');
    expect(modelSelector).toContain('runcrate: "rc"');
  });

  it("carries the runcrate models verbatim", () => {
    expect(block(tuiProviders, "rc")).toContain("deepseek-ai/DeepSeek-V4.1-Flash");
    expect(block(tuiProviders, "rc")).toContain("zai-org/GLM-5.3");
    expect(block(tuiProviders, "rc")).toContain("openai/gpt-oss-120b");
  });

  it("new TUI model ids exist in the open-sse registry", () => {
    const ids = (file) =>
      [...readFileSync(join(here, "../../open-sse/providers/registry", file), "utf8")
        .matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
    const registry = new Set(ids("runcrate.js"));
    for (const id of [
      "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4.1-Flash-1017",
      "zai-org/GLM-5.3", "zai-org/GLM-5.3-Flash",
      "Qwen/Qwen3.8-Flash", "openai/gpt-oss-120b",
    ]) {
      expect(registry.has(id), `${id} missing from registry`).toBe(true);
    }
  });
});
