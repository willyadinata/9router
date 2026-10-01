# AGENTS.md — develop branch (9router+)

develop = upstream `9router` (Next.js, `master`) + port **Elysia + Bun + Vite** +
rebrand **9router+**. Upstream tetap sumber kebenaran untuk engine (`open-sse/`),
provider registry, translator, dan API routes. develop hanya menambah lapisan
runtime di atasnya. Jangan pernah port balik ke master.

## Layout: mana milik siapa

| Tree | Owner | Keterangan |
|---|---|---|
| `src/app/api/**`, `src/sse/**`, `open-sse/**` | upstream | Di-merge dari master apa adanya |
| `server/` | develop-only | Backend Elysia: `src/index.ts`, `src/dispatch.ts`, `src/scan.ts`, `src/shims/*`, `scripts/sync-vendor.ts` |
| `web/` | develop-only | Dashboard Vite (hasil `make sync` + codemod dari `src/`) |
| `server/vendor/`, `server/src/routes-manifest.ts`, `web/src/`, `web/dist` | generated | Output `make sync` / build. Git-ignored. Jangan hand-edit |
| `Makefile`, `bun.lock`, `server/bun.lock`, `web/bun.lock` | develop-only | Tooling port |
| `src/shared/constants/brand.js`, `cli/src/cli/constants/brand.js` | develop-only | Identitas cabang (lihat §2) |
| `src/lib/network/undici.js` | develop-only | Choke point undici asli (lihat §2) |
| `src/sse/services/proxyAutoFetch.js`, `src/app/api/proxy-pools/fetch/**` | develop-only | Fitur fetch pool develop |

## Yang HARUS dipertahankan (jangan biarkan upstream timpa)

Konflik merge di file-file ini: selalu menangkan develop, lalu jahit nilai
upstream ke dalamnya (compose, bukan pilih salah satu).

1. **Brand.** `BRAND_NAME`/`APP_DIR_NAME` hidup di dua file brand di atas
   (CLI tidak bisa import lintas package). Yang tetap `9router`: nama npm,
   nama command, process-kill matcher, `x-9r-*` headers, `model_providers.9router`
   keys, autostart identity. Yang jadi `9router+`: display name + data dir
   (`~/.9router`, bukan `~/.9router`).
2. **Data dir.** `src/lib/dataDir.js` ekspor `DEFAULT_DATA_DIR` dari brand;
   `cli/cli.js` (`getAppDataDir`) dan `cli/src/cli/api/client.js` wajib ikut.
   Upstream meng-hardcode `~/.9router` — menangkan develop atau data user
   tertimpa instalasi upstream.
3. **Machine id acak per-run.** `node-machine-id` sudah dibuang dari kedua
   `package.json`. ID = 64-hex random di `DATA_DIR/machine-id`
   (`src/shared/utils/machineId.js`, `open-sse/shared/machineId.js`).
   Jangan bawa balik dep itu. CLI tidak boleh cache token lintas panggilan
   (`cli/src/cli/api/client.js`) karena server menulis ulang file tiap start.
   Konsekuensi: ID tidak stabil antar restart — disengaja, sudah tercatat di
   `tests/unit/machine-id-random.test.js` dan wording `MACHINE_ID_SALT` di
   `.env.example` + i18n.
4. **Undici lewat choke point.** Bun meng-hijack bare specifier `undici`
   (import maupun require) ke builtin-nya — ProxyAgent/dispatcher berbeda,
   request ter-proxy diam-diam jalan DIRECT. Semua import wajib lewat
   `src/lib/network/undici.js` (path relatif eksplisit, bukan bare specifier).
   Titik yang sudah patuh: `open-sse/utils/proxyFetch.js`,
   `open-sse/translator/concerns/image.js`, `src/lib/network/proxyTest.js`.
   Bare `from "undici"` di tree itu = bug; grep sebelum commit.
5. **SOCKS = health-check only.** `SocksProxyAgent` itu `http.Agent`, bukan
   undici Dispatcher, dan Bun fetch tidak punya opsi proxy SOCKS. Aturannya:
   pool SOCKS boleh di-health-check dan di-manage (`proxyTest.js`
   `checkViaSocks` via `node:https`), tapi `proxyFetch.js#getDispatcher`
   wajib throw untuk scheme `socks*` agar traffic tidak bocor direct.
   Jangan "perbaiki" dengan me-routing SOCKS via undici.
6. **Launcher mengenali Bun.** `cli/cli.js` kill-matcher mencakup proses
   `bun … 9router … index.ts`; `cli/hooks/postinstall.js` cek `bun --version`.
7. **Docker = image Elysia.** `Dockerfile` (base `oven/bun`, tanpa Node/Next),
   `.dockerignore` versi develop, `DOCKER.md`. Compose memakai
   `DATA_DIR=/app/data` + volume `9router-data`.

## Yang HARUS di-update tiap ada update master

1. **Merge dengan `--no-commit --no-ff`.** Hitung dual-touched dulu
   (`comm` dua `git diff --name-only <base>..`): itu kandidat konflik.
   Resolve dengan compose (fitur upstream + shim develop), lalu
   `node --check` tiap file sebelum staging.
2. **Version bump bawaan merge tidak dibalik.** Termasuk `server/package.json`
   (di-sync otomatis oleh `sync-vendor.ts`).
3. **`make sync` penuh dari root** (`sync-server` + `sync-web`; `bun run sync`
   di dalam `server/` saja tidak cukup). Pastikan route baru muncul di
   `routes-manifest.ts`. `git status` yang hanya menunjukkan bump
   `server/package.json` itu normal — sisanya gitignored.
4. **Keputusan vendoring untuk helper baru.** `sync-vendor.ts` meng-copy
   seluruh `src/app/api` + `dashboardGuard.js`; helper `src/lib/*` tanpa
   import `next/*` tetap live via `@/*` paths (jangan di-vendor — relative
   `../../open-sse/*` mereka rusak di dalam vendor). Screen murah:
   `grep -c next/` pada file yang berubah.
5. **Cabang middleware baru.** `src/proxy.js` mati di Elysia — setiap branch
   baru wajib jadi fungsi `run*` di `server/src/dispatch.ts`, dipanggil
   sebelum `runGuard` dengan urutan yang sama. (Sejak base v0.5.91 belum ada
   perubahan `src/proxy.js`; prosedur ini berjaga untuk nanti.)
6. **Katalog statis TUI** (`cli/src/cli/menus/providers.js`,
   `cli/src/cli/utils/modelSelector.js`): provider baru → tambah ke
   `PROVIDER_MODELS` + `OAUTH_PROVIDERS`/`APIKEY_PROVIDERS` (+
   `DEVICE_CODE_PROVIDERS` bila device-flow); model baru → entry alias yang
   sesuai; alias/nama baru → `PROVIDER_ALIAS_ORDER`, `PROVIDER_ID_TO_ALIAS`,
   `PROVIDER_ALIAS_NAMES`. Search/fetch-only provider (mis. TinyFish) bukan
   provider chat — jangan masuk daftar koneksi. Dijaga oleh
   `tests/unit/tui-catalog-sync.test.js`.
7. **Daftar dep runtime ganda.** `ROOT_RUNTIME_DEPS` (`cli/scripts/build-cli.js`)
   dan `keep` (`Dockerfile` baris `bun -e`) wajib sinkron dengan `package.json`
   setiap ada dep tambah/hapus. Copy bundel mengikuti closure transitif
   (`collectRuntimeClosure`); `assertRuntimeClosure` menggagalkan build bila
   ada yang hilang. Pelajaran 0.5.95: copy top-level saja menjatuhkan
   `socks`/`xml-crypto` dari bundel terinstall.
8. **Registry provider baru** → `make registry` bila `registry/index.js`
   tidak ikut ter-generate upstream.
9. **CHANGELOG master di-keep** apa adanya.

## Verifikasi tiap porting

- `cd tests && npx vitest run unit/<file-sentuh>.test.js` (wajib hijau:
  `tui-catalog-sync`, `cli-build-artifacts`, `machine-id-random`,
  `strict-proxy-enforcement` bila menyentuh areanya).
- Full suite tidak hijau di checkout bersih (~100 gagal bawaan:
  network/kredensial). Regresi dinilai dengan `comm` tiga worktree
  (develop-merge vs master-tip vs pre-merge-base), bukan run mentah —
  prosedur di skill `9router-gateway`.
- `make smoke` (port 20145 + HOME/DATA_DIR sandbox; bunuh hanya child sendiri).
- Jangan sentuh instance user di :20128 untuk verifikasi; cek sehat via
  `/api/health` saja.
- Jangan commit: artefak run lokal
  `tests/translator/__snapshots__/golden-url-header.test.js.snap`
  (machine-dependent), `cli/app/`, `node_modules/`, `*.tgz`.
- Commit: Conventional Commits, body Inggris menjelaskan mekanisme.
  Jangan push kecuali diminta.
