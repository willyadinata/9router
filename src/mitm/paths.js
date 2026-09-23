// Data directory for the mitm child process (CommonJS, bundled separately by
// cli/scripts/buildMitm.js) — mirrors src/shared/constants/brand.js, which lives in the
// ESM app tree and cannot be required from here.
const fs = require("fs");
const path = require("path");
const os = require("os");

const APP_DIR_NAME = "9router";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      APP_DIR_NAME,
    );
  }
  return path.join(os.homedir(), `.${APP_DIR_NAME}`);
}

function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();
  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(
        `[DATA_DIR] '${configured}' not writable → fallback ${defaultDir()}`,
      );
      return defaultDir();
    }
    throw e;
  }
}

const DATA_DIR = getDataDir();
const MITM_DIR = path.join(DATA_DIR, "mitm");

module.exports = { DATA_DIR, MITM_DIR };
