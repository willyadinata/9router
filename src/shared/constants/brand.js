// Branch-local identity for the 9router build.
//
// Display name and data directory only. Functional identifiers deliberately stay on
// "9router": the x-9r-* headers, the `model_providers.9router` / `custom:9Router-0` config
// keys written into other CLI tools, the 9router model aliases, and the npm package name
// (updates still install the published `9router` package).
export const BRAND_NAME = "9router+";

// Data directory name. Hidden on unix (~/.9router) and plain under %APPDATA% on
// Windows, mirroring the upstream convention, so this branch never touches ~/.9router.
export const APP_DIR_NAME = "9router";
