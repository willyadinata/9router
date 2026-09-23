import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, ".."); // repo root: ../src, ../open-sse, ../public

export default defineConfig(({ mode }) => {
  // Backend port comes from the same env the Elysia server reads, so the dev
  // proxy can never silently point at another running instance.
  const env = loadEnv(mode, root, "");
  const backend = env.PORT ? `http://127.0.0.1:${env.PORT}` : "http://127.0.0.1:20128";
  return {
    envDir: root,
    plugins: [react(), tailwindcss()],
    // Engine config modules read process.env at module scope (Next/webpack
    // polyfills it). The dashboard needs no env at runtime — stub it.
    define: { "process.env": {} },
    resolve: {
      alias: {
        "@": join(here, "src"),
        "open-sse": join(root, "open-sse"),
        // UI imports of engine config modules drag in `os` (platform/arch
        // fingerprint) — stub it for the browser (see src/stub-os.js).
        os: join(here, "src", "stub-os.js"),
      },
    },
    server: {
      port: 20183,
      strictPort: true,
      proxy: {
        "/api": backend,
        "/v1": backend,
        "/v1beta": backend,
        "/codex": backend,
        "/responses": backend,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000,
    },
  };
});
