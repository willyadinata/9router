import fs from "node:fs";
import path from "path";
import os from "os";
import { APP_DIR_NAME } from "@/shared/constants/brand";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_DIR_NAME);
  }
  return path.join(os.homedir(), `.${APP_DIR_NAME}`);
}

// Resolved once at import time. Other server modules (app updater, npm updater, mitm alias
// cache, mitm child) reuse this instead of rebuilding "~/.9router" by hand, so the data
// directory is renamed in exactly one place.
export const DEFAULT_DATA_DIR = defaultDir();

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return DEFAULT_DATA_DIR;

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to ${DEFAULT_DATA_DIR}`);
    return DEFAULT_DATA_DIR;
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ${DEFAULT_DATA_DIR}`);
      return DEFAULT_DATA_DIR;
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
