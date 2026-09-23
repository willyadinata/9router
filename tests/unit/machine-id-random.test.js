import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The machine id must be generated locally, never read from the hardware, and must be
// fresh for every run while staying identical for every reader inside that run.
let tmpDir;

async function loadModule() {
  vi.resetModules();
  return await import("@/shared/utils/machineId");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-machine-id-"));
  process.env.DATA_DIR = tmpDir;
  delete process.env.NINEROUTER_MACHINE_ID;
  delete process.env.MACHINE_ID_SALT;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.NINEROUTER_MACHINE_ID;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initMachineId", () => {
  it("writes a fresh 64-hex id per run, and the file follows so the CLI picks up the new token", async () => {
    const first = (await loadModule()).initMachineId();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(tmpDir, "machine-id"), "utf8")).toBe(first);

    // Next run = next process: fresh module state, no boot-time stamp inherited.
    delete process.env.NINEROUTER_MACHINE_ID;
    const nextRun = await loadModule();
    const second = nextRun.initMachineId();
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(await nextRun.getRawMachineId()).toBe(second);
  });

  it("adopts NINEROUTER_MACHINE_ID stamped by custom-server.js instead of rolling its own", async () => {
    process.env.NINEROUTER_MACHINE_ID = "a".repeat(64);
    const { initMachineId } = await loadModule();
    expect(initMachineId()).toBe("a".repeat(64));
  });

  it("keeps the run's id when the data dir is not writable (warns, never throws)", async () => {
    fs.chmodSync(tmpDir, 0o500);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { initMachineId, getRawMachineId } = await loadModule();
      const raw = initMachineId();
      expect(raw).toMatch(/^[0-9a-f]{64}$/);
      expect(await getRawMachineId()).toBe(raw);
      expect(warn).toHaveBeenCalled();
      expect(fs.existsSync(path.join(tmpDir, "machine-id"))).toBe(false);
      expect(fs.readdirSync(tmpDir).some((n) => n.includes(".tmp"))).toBe(false);
    } finally {
      warn.mockRestore();
      fs.chmodSync(tmpDir, 0o700);
    }
  });
});

describe("getConsistentMachineId", () => {
  it("returns a stable 16-hex token per run, changing only when the run changes", async () => {
    const { initMachineId, getConsistentMachineId } = await loadModule();

    initMachineId();
    const token = await getConsistentMachineId();
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(await getConsistentMachineId()).toBe(token);

    delete process.env.NINEROUTER_MACHINE_ID;
    const nextRun = await loadModule();
    nextRun.initMachineId();
    expect(await nextRun.getConsistentMachineId()).not.toBe(token);
  });

  it("keeps the CLI-token salt stable for a reader that never calls initMachineId", async () => {
    const { getConsistentMachineId } = await loadModule();
    const raw = "b".repeat(64);
    process.env.NINEROUTER_MACHINE_ID = raw;
    fs.writeFileSync(path.join(tmpDir, "machine-id"), raw);

    // Same inputs as cli/src/cli/api/client.js getCliToken(): raw + salt + persisted secret.
    const cliTokenSalt = "9r-cli-auth";
    const serverToken = await getConsistentMachineId(cliTokenSalt);
    const secret = fs.readFileSync(path.join(tmpDir, "auth", "cli-secret"), "utf8").trim();
    const cliToken = (await import("node:crypto"))
      .createHash("sha256")
      .update(raw + cliTokenSalt + secret)
      .digest("hex")
      .substring(0, 16);

    expect(serverToken).toBe(cliToken);
  });
});
