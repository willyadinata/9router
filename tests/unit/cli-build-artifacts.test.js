import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let testApi;
try {
  testApi = await import("vitest");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  testApi = await import("node:test");
}
const { afterEach, describe, it } = testApi;

const require = createRequire(import.meta.url);
const {
  assertRuntimeClosure,
  collectRuntimeClosure,
  copyPackageDir,
  copyRuntimeClosure,
} = require("../../cli/scripts/build-cli.js");

const tempDirs = [];

function createTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cli-build-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeFixture(root, relativePath, contents = relativePath) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

// Fake a hoisted node_modules: every package (roots + transitives) lives
// flat at top level, like npm/bun hoisting produces for the real install.
function writePkg(nmDir, name, dependencies = {}) {
  writeFixture(
    nmDir,
    path.join(name, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js", dependencies }),
  );
  // Realistic entry point: actually requires its declared deps, so
  // require.resolve-based checks behave like the production bundle.
  const requires = Object.keys(dependencies)
    .map((dep) => `require(${JSON.stringify(dep)});`)
    .join("\n");
  writeFixture(nmDir, path.join(name, "index.js"), `${requires}\nmodule.exports = {};\n`);
}

function createHoistedNm(root, tree) {
  const nmDir = path.join(root, "node_modules");
  for (const [name, deps] of Object.entries(tree)) {
    writePkg(nmDir, name, deps);
  }
  return nmDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("CLI runtime dependency closure", () => {
  it("collects the transitive closure from a hoisted layout", () => {
    const root = createTempDir();
    const nmDir = createHoistedNm(root, {
      "top-a": { "mid-b": "^1.0.0", leaf: "^1.0.0" },
      "mid-b": { leaf: "^1.0.0" },
      leaf: {},
      unrelated: {},
    });

    const closure = collectRuntimeClosure(nmDir, ["top-a"]);

    assert.deepEqual([...closure].sort(), ["leaf", "mid-b", "top-a"]);
  });

  it("copies roots plus hoisted transitives into the bundle", () => {
    const root = createTempDir();
    const nmDir = createHoistedNm(root, {
      "socks-proxy-agent": { socks: "^2.8.3" },
      socks: {},
      unrelated: {},
    });
    const cliAppDir = path.join(root, "cli-app");

    const closure = copyRuntimeClosure(nmDir, cliAppDir, ["socks-proxy-agent"]);

    assert.deepEqual([...closure].sort(), ["socks", "socks-proxy-agent"]);
    assert.equal(
      fs.existsSync(path.join(cliAppDir, "node_modules", "socks-proxy-agent", "package.json")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(cliAppDir, "node_modules", "socks", "package.json")),
      true,
    );
    assert.equal(fs.existsSync(path.join(cliAppDir, "node_modules", "unrelated")), false);
  });

  it("assertRuntimeClosure passes on a complete bundle", () => {
    const root = createTempDir();
    const nmDir = createHoistedNm(root, {
      "socks-proxy-agent": { socks: "^2.8.3" },
      socks: {},
    });
    const cliAppDir = path.join(root, "cli-app");
    copyRuntimeClosure(nmDir, cliAppDir, ["socks-proxy-agent"]);

    assert.doesNotThrow(() => assertRuntimeClosure(cliAppDir, ["socks-proxy-agent"]));
  });

  it("assertRuntimeClosure catches a missing deep (depth-2) transitive", () => {
    const root = createTempDir();
    const nmDir = createHoistedNm(root, {
      "top-a": { "mid-b": "^1.0.0" },
      "mid-b": { "deep-leaf": "^1.0.0" },
      "deep-leaf": {},
    });
    const cliAppDir = path.join(root, "cli-app");
    // Only copy depth 0-1: deep-leaf missing must still be caught.
    copyPackageDir("top-a", cliAppDir, nmDir);
    copyPackageDir("mid-b", cliAppDir, nmDir);

    assert.throws(
      () => assertRuntimeClosure(cliAppDir, ["top-a"]),
      (error) => error.message.includes("mid-b -> deep-leaf"),
    );
  });

  it("assertRuntimeClosure fails when a hoisted transitive is dropped (the 0.5.95 socks/xml-crypto bug)", () => {
    const root = createTempDir();
    const nmDir = createHoistedNm(root, {
      "socks-proxy-agent": { "fixture-leaf": "^9.9.9" },
      "fixture-leaf": {},
    });
    const cliAppDir = path.join(root, "cli-app");
    // Simulate the old top-level-only copy: root copied, hoisted dep missing.
    copyPackageDir("socks-proxy-agent", cliAppDir, nmDir);

    assert.throws(
      () => assertRuntimeClosure(cliAppDir, ["socks-proxy-agent"]),
      (error) => error.message.includes("socks-proxy-agent -> fixture-leaf"),
    );
  });

  it("collectRuntimeClosure reports which hoisted package is absent", () => {
    const root = createTempDir();
    const nmDir = createHoistedNm(root, {
      "socks-proxy-agent": { socks: "^2.8.3" },
      // socks deliberately NOT installed
    });

    assert.throws(
      () => collectRuntimeClosure(nmDir, ["socks-proxy-agent"]),
      (error) => error.message.includes("socks"),
    );
  });

  it("copyPackageDir throws a actionable error for a missing source", () => {
    const root = createTempDir();
    const nmDir = path.join(root, "node_modules");
    fs.mkdirSync(nmDir, { recursive: true });

    assert.throws(
      () => copyPackageDir("nope-missing", path.join(root, "cli-app"), nmDir),
      (error) => error.message.includes("nope-missing"),
    );
  });
});
