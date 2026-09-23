// Branch-local identity for the 9router-plus build (CLI side). Mirrors
// src/shared/constants/brand.js, which cannot be imported across the package boundary.
//
// Display name and data directory only: the npm package name, the `9router` command name,
// the process-kill matchers for the published CLI and the os autostart identity all stay
// on "9router" so updates and autostart entries keep working.
const os = require("os");
const path = require("path");

const BRAND_NAME = "9router+";

// Hidden on unix (~/.9router-plus), plain under %APPDATA% on Windows — same convention as
// the upstream ~/.9router, which this branch leaves untouched.
const APP_DIR_NAME = "9router-plus";

const DEFAULT_DATA_DIR = process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_DIR_NAME)
  : path.join(os.homedir(), `.${APP_DIR_NAME}`);

module.exports = { BRAND_NAME, APP_DIR_NAME, DEFAULT_DATA_DIR };
