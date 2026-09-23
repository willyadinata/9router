// Vendor sync: copies the Next route tree + guard verbatim into server/vendor
// so every file importing `next/server` / `next/headers` lives under server/
// (where server/tsconfig.json maps those to ./src/shims/*).
// Run: `bun run sync` (also runs the route-manifest generator).
// Re-run after pulling upstream or editing src/app/api/**.
import { rm, mkdir, cp, readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const VENDOR = join(HERE, "..", "vendor");

await rm(VENDOR, { recursive: true, force: true });
await mkdir(join(VENDOR, "app"), { recursive: true });

// 1. API tree (route.js + colocated helpers like filters.js/testUtils.js/ping.js)
await cp(join(ROOT, "src", "app", "api"), join(VENDOR, "app", "api"), { recursive: true });
// 2. Auth guard (imports next/server like the routes do)
await cp(join(ROOT, "src", "dashboardGuard.js"), join(VENDOR, "dashboardGuard.js"));

// 2b. Vendored routes import "@/dashboardGuard", which would resolve to the
// LIVE src/ copy outside server/ (nearest-config trap: real next/server).
// Rewrite to the vendored copy with a depth-aware relative specifier.
async function* vendorJs(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* vendorJs(p);
    else if (e.isFile() && e.name.endsWith(".js")) yield p;
  }
}
for await (const f of vendorJs(VENDOR)) {
  let s = await readFile(f, "utf8");
  if (!s.includes("@/dashboardGuard")) continue;
  let rel = relative(dirname(f), join(VENDOR, "dashboardGuard.js")).split(sep).join("/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  s = s.replace(/from\s*(["'])(?:@\/dashboardGuard)\1/g, `from "${rel}"`);
  await writeFile(f, s);
  console.log(`rewired @/dashboardGuard -> ${rel} in ${relative(VENDOR, f)}`);
}

// 3. version/route.js reads ../../../../package.json for the app version —
//    at vendor depth that resolves to server/package.json, so keep it in sync.
const rootPkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const serverPkgPath = join(HERE, "..", "package.json");
const serverPkg = JSON.parse(await readFile(serverPkgPath, "utf8"));
if (serverPkg.version !== rootPkg.version) {
  serverPkg.version = rootPkg.version;
  await writeFile(serverPkgPath, JSON.stringify(serverPkg, null, 2) + "\n");
  console.log(`synced server version -> ${rootPkg.version}`);
}

console.log("vendor synced: app/api + dashboardGuard.js");

// 4. regenerate the manifest from the vendored tree
await import("../src/scan.ts");
