#!/usr/bin/env node

// Build the CLI `app/` bundle: the Elysia backend (Bun) + the Vite dashboard.
// Mirrors the Docker runner stage — same files, same layout — so the launcher
// spawns exactly what production runs. No Next.js involved.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const cliAppDir = process.env.NINEROUTER_CLI_APP_DIR || path.join(cliDir, "app");

// Root engine deps the Elysia server resolves at runtime (same keep-list as
// the Dockerfile runner stage — versions stay pinned to the root manifest).
const ROOT_RUNTIME_DEPS = [
  "@node-saml/node-saml",
  "bcryptjs",
  "chalk",
  "confbox",
  "jose",
  "node-forge",
  "open",
  "ora",
  "socks-proxy-agent",
  "sql.js",
  "undici",
  "uuid",
];

// Never copied into the bundle (secrets, caches, VCS, previous builds).
const EXCLUDE_NAMES = new Set([
  ".build-home",
  ".env",
  ".env.local",
  ".git",
  ".next",
  ".next-cli-build",
  "node_modules",
  "*.log",
  ".DS_Store",
]);

function shouldExclude(name) {
  for (const pattern of EXCLUDE_NAMES) {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if (regex.test(name)) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  // .env.*.local variants
  if (name.startsWith(".env.") && name.endsWith(".local")) return true;
  return false;
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`Warning: Source ${src} does not exist`);
    return;
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip broken symlinks (common in workspace setups)
    try {
      fs.accessSync(srcPath);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      // Resolve and copy target (avoid linking outside bundle)
      try {
        const real = fs.realpathSync(srcPath);
        if (fs.statSync(real).isDirectory()) {
          copyRecursive(real, destPath);
        } else {
          fs.copyFileSync(real, destPath);
        }
      } catch {}
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch {}
    }
  }
}

function copyPackageDir(pkgName, destRoot) {
  const src = path.join(appDir, "node_modules", pkgName);
  if (!fs.existsSync(src)) {
    throw new Error(
      `${pkgName} not found in root node_modules — run 'bun install' at the repo root first.`,
    );
  }
  copyRecursive(src, path.join(destRoot, "node_modules", pkgName));
}

function assertElysiaArtifacts() {
  const required = [
    "server/src/index.ts",
    "server/src/routes-manifest.ts",
    "server/vendor",
    "server/tsconfig.json",
    "package.json",
    "jsconfig.json",
    "web/dist/index.html",
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(cliAppDir, rel)));
  if (missing.length > 0) {
    throw new Error(`Required Elysia bundle artifact${missing.length === 1 ? " is" : "s are"} missing:\n` + missing.join("\n"));
  }
}

function buildCliPackage() {
  console.log("📦 Building 9Router CLI package (Elysia + Bun)...\n");

  // Step 0: Sync version from cli/package.json to root package.json
  console.log("0️⃣  Syncing version to package.json...");
  const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
  const rootPkgPath = path.join(appDir, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  if (rootPkg.version !== cliPkg.version) {
    rootPkg.version = cliPkg.version;
    fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
    console.log(`✅ Version synced: ${cliPkg.version}\n`);
  } else {
    console.log(`✅ Version already synced: ${cliPkg.version}\n`);
  }

  // Step 1: Regenerate the vendored API routes + route manifest (build-time,
  // so the launcher never writes into its own install dir at runtime).
  console.log("1️⃣  Syncing Elysia vendor routes...");
  try {
    execSync("bun run sync", { stdio: "inherit", cwd: path.join(appDir, "server") });
    console.log("✅ Vendor routes synced\n");
  } catch (error) {
    console.error("❌ Server sync failed (is Bun installed? run 'bun install' in server/ first)");
    process.exit(1);
  }

  // Step 2: Build the dashboard SPA (skipped when web/dist is already fresh —
  // set NINEROUTER_CLI_SKIP_WEB=1 to skip unconditionally).
  if (!process.env.NINEROUTER_CLI_SKIP_WEB) {
    console.log("2️⃣  Building dashboard SPA...");
    try {
      execSync("bun run build", { stdio: "inherit", cwd: path.join(appDir, "web") });
      console.log("✅ Dashboard built\n");
    } catch (error) {
      console.error("❌ Web build failed");
      process.exit(1);
    }
  } else {
    console.log("2️⃣  Skipping dashboard build (NINEROUTER_CLI_SKIP_WEB=1)\n");
  }

  // Step 3: Clean old cli/app if exists
  console.log("3️⃣  Cleaning old cli/app...");
  if (fs.existsSync(cliAppDir)) {
    fs.rmSync(cliAppDir, { recursive: true, force: true });
  }
  console.log("✅ Cleaned\n");

  // Step 4: Copy the Elysia server tree (mirrors the Dockerfile runner stage).
  console.log("4️⃣  Copying Elysia server bundle...");
  for (const rel of ["server/src", "server/scripts", "server/vendor", "src", "open-sse", "web/dist"]) {
    copyRecursive(path.join(appDir, rel), path.join(cliAppDir, rel));
  }
  for (const file of ["package.json", "jsconfig.json", "server/package.json", "server/tsconfig.json"]) {
    const src = path.join(appDir, file);
    if (!fs.existsSync(src)) {
      console.error(`❌ Required file missing: ${file}`);
      process.exit(1);
    }
    const dest = path.join(cliAppDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  console.log("✅ Copied server bundle\n");

  // Step 5: Copy pruned runtime node_modules (root engine deps + Elysia).
  // Native/heavy leftovers (better-sqlite3, next, React dashboard libs) stay
  // out; sql.js covers SQLite, the data-dir runtime self-heals the rest.
  console.log("5️⃣  Copying pruned runtime dependencies...");
  for (const pkg of ROOT_RUNTIME_DEPS) {
    copyPackageDir(pkg, cliAppDir);
  }
  copyRecursive(path.join(appDir, "server", "node_modules"), path.join(cliAppDir, "server", "node_modules"));
  const betterDir = path.join(cliAppDir, "node_modules", "better-sqlite3");
  if (fs.existsSync(betterDir)) {
    fs.rmSync(betterDir, { recursive: true, force: true });
    console.log("✅ Stripped better-sqlite3 (lives in the data dir runtime)");
  }
  console.log("✅ Copied runtime dependencies\n");

  // Step 6: Verify the bundle is launchable.
  console.log("6️⃣  Verifying bundle artifacts...");
  assertElysiaArtifacts();
  console.log("✅ Bundle verified\n");

  // Step 7: Build MITM server (config driven - see cli/scripts/buildMitm.js).
  // buildMitm bundles src/mitm/server.js in place and wipes the other sources,
  // but the Elysia gateway imports @/mitm/manager et al. — so restore every
  // source file EXCEPT server.js (nobody imports it as a module; the sidecar
  // is spawned as a child process and must stay the self-contained bundle).
  console.log("7️⃣  Building MITM server...");
  try {
    execSync("node scripts/buildMitm.js", { stdio: "inherit", cwd: cliDir });
    console.log("✅ MITM server build completed\n");
  } catch (error) {
    console.error("❌ MITM build failed");
    process.exit(1);
  }

  console.log("7️⃣ b Restoring MITM sources needed by the gateway...");
  {
    const mitmSrc = path.join(appDir, "src", "mitm");
    const mitmDest = path.join(cliAppDir, "src", "mitm");
    const entries = fs.readdirSync(mitmSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "server.js") continue; // keep the bundle
      const s = path.join(mitmSrc, entry.name);
      const d = path.join(mitmDest, entry.name);
      if (entry.isDirectory()) copyRecursive(s, d);
      else fs.copyFileSync(s, d);
    }
    console.log("✅ MITM sources restored\n");
  }

  console.log("✨ CLI package build completed!");
  console.log(`📁 Output: ${cliAppDir}`);

  try {
    const size = execSync(`du -sh "${cliAppDir}"`, { encoding: "utf8" }).trim();
    console.log(`📊 Package size: ${size.split("\t")[0]}`);
  } catch (e) {
    // Silent fail on size check
  }
}

module.exports = {
  assertElysiaArtifacts,
  copyPackageDir,
  ROOT_RUNTIME_DEPS,
};

if (require.main === module) {
  buildCliPackage();
}
