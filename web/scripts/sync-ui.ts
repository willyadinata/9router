// UI sync: copies the dashboard tree verbatim into web/src and applies the
// Next.js -> pure-React codemod. Re-run via `bun run sync` after pulling
// upstream or editing src/**. Hand-written files (next-compat, router, main,
// index.html, vite.config) are never touched by this script.
import { rm, mkdir, cp, readdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const REPO = join(ROOT, "..");
const SRC = join(ROOT, "src");

const COPY_DIRS = ["shared", "store", "i18n", "models"];

// Only clear synced trees — hand-written web/src/*.{jsx,js} (main, router,
// next-compat) must survive re-syncs.
for (const d of [...COPY_DIRS, "app"]) {
  await rm(join(SRC, d), { recursive: true, force: true });
}
await rm(join(ROOT, "public"), { recursive: true, force: true });
await mkdir(SRC, { recursive: true });

// app/** except the API tree (served by the Elysia backend, not the SPA)
await mkdir(join(SRC, "app"), { recursive: true });
async function copyApp(srcDir, dstDir) {
  for (const e of await readdir(srcDir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "api") continue;
      await mkdir(join(dstDir, e.name), { recursive: true });
      await copyApp(join(srcDir, e.name), join(dstDir, e.name));
    } else {
      await cp(join(srcDir, e.name), join(dstDir, e.name));
    }
  }
}
await copyApp(join(REPO, "src", "app"), join(SRC, "app"));
for (const d of COPY_DIRS) {
  await cp(join(REPO, "src", d), join(SRC, d), { recursive: true });
}
await cp(join(REPO, "public"), join(ROOT, "public"), { recursive: true });

// ---- codemod: next/* -> @/next-compat ----
const LINK_RE = /from\s*(["'])next\/link\1/g;
const NAV_RE = /from\s*(["'])next\/navigation\1/g;
const IMG_RE = /from\s*(["'])next\/image\1/g;
const DYN_RE = /import\s+dynamic\s+from\s*(["'])next\/dynamic\1/g;

async function* jsFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsFiles(p);
    else if (e.isFile() && e.name.endsWith(".js")) yield p;
  }
}

const JSX_HINT = /<>|<(?! |=)[A-Za-z][A-Za-z0-9]*[\s>/]/;
const renamed = new Map(); // dir -> Set(basename without ext)

for await (const f of jsFiles(SRC)) {
  if (basename(f) === "next-compat.jsx" || basename(f) === "router.jsx" || basename(f) === "main.jsx") continue;
  let s = await readFile(f, "utf8");
  const orig = s;
  s = s.replace(LINK_RE, 'from "@/next-compat"');
  // next/link uses a DEFAULT import, but the compat's default export is Image.
  // Convert to the named Link or nav links render as invisible <img> tags.
  s = s.replace(/import\s+Link\s+from\s*(["'])@\/next-compat\1/g, 'import { Link } from "@/next-compat"');
  s = s.replace(NAV_RE, 'from "@/next-compat"');
  s = s.replace(IMG_RE, 'from "@/next-compat"');
  s = s.replace(DYN_RE, 'import { dynamic } from "@/next-compat"');
  if (f.endsWith("globals.css") || f.endsWith(".css")) continue;
  // CJS -> ESM: `module.exports = { A, B };` (names already declared in-file)
  // becomes a named-export list so bundler named imports keep working.
  s = s.replace(/module\.exports\s*=\s*\{([^}]*)\};?/g, "export { $1 };");
  if (s !== orig) await writeFile(f, s);
  // rename JSX-in-.js to .jsx (Vite only parses JSX in .jsx/.tsx)
  if (JSX_HINT.test(s)) {
    const dir = dirname(f);
    const base = basename(f, ".js");
    await rename(f, join(dir, base + ".jsx"));
    if (!renamed.has(dir)) renamed.set(dir, new Set());
    renamed.get(dir).add(base);
  }
}

// fix explicit relative ./Foo.js imports pointing at renamed files
async function* allSrc(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* allSrc(p);
    else if (e.isFile() && (e.name.endsWith(".js") || e.name.endsWith(".jsx"))) yield p;
  }
}
for await (const f of allSrc(SRC)) {
  if (basename(f) === "next-compat.jsx" || basename(f) === "router.jsx" || basename(f) === "main.jsx") continue;
  const set = renamed.get(dirname(f));
  if (!set || set.size === 0) continue;
  let s = await readFile(f, "utf8");
  let changed = false;
  for (const base of set) {
    const needle1 = `./${base}.js`;
    const needle2 = `../${base}.js`;
    if (s.includes(needle1) || s.includes(needle2)) {
      // only rewrite when the target file was actually renamed (same-dir or parent-dir hit)
      changed = true;
    }
  }
  if (changed) {
    s = s.replace(/(\.\.?\/[^"'`]*?)\.js(["'`])/g, (m, p, q) => {
      const name = p.split("/").pop();
      return set.has(name) || [...renamed.values()].some((st) => st.has(name)) ? `${p}.jsx${q}` : m;
    });
    await writeFile(f, s);
  }
}

// globals.css: tailwind source base moves from src/ to web/src.
// NOTE: Tailwind v4 automatic content detection SKIPS gitignored files, and
// the synced UI trees (src/app, src/shared, ...) are gitignored by design.
// Register them as explicit @source paths (explicit sources are always
// scanned) or responsive variants (md:/lg:) silently vanish from the build.
const globalsPath = join(SRC, "app", "globals.css");
try {
  let g = await readFile(globalsPath, "utf8");
  g = g.replace('source("../../")', 'source("../")');
  if (!g.includes('@source "../app"')) {
    // Paths are relative to this CSS file (web/src/app/). Explicit sources
    // bypass the .gitignore filter that hides the synced trees from
    // automatic content detection.
    g += '\n@source "../app";\n@source "../shared";\n@source "../store";\n@source "../i18n";\n@source "../models";\n';
  }
  await writeFile(globalsPath, g);
} catch {}

let count = 0;
for await (const f of allSrc(SRC)) count++;
console.log(`ui synced: ${count} source files, ${[...renamed.values()].reduce((n, s) => n + s.size, 0)} renamed to .jsx`);
