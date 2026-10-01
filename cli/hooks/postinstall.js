#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into the data dir's runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
// `npx 9router …` (npm_command=exec) is typically a one-shot `connect` — skip
// the runtime warm-up; cli.js self-heals it if the server is started later.
if (process.env.npm_command === "exec") process.exit(0);

const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[9router] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[9router] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[9router] tray runtime skipped: ${e.message}`);
}

// The bundled gateway runs on Bun (the launcher itself stays on Node).
// Non-fatal: cli.js re-checks at startup with the same guidance.
try {
  require("child_process").execSync("bun --version", { stdio: "ignore", timeout: 10000 });
} catch {
  console.warn("[9router] bun not found on PATH — the gateway needs it.");
  console.warn("[9router] Install it from https://bun.sh, then run `9router` again.");
}

process.exit(0);
