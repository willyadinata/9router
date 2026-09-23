# Docker — 9router+ (Elysia + Bun + Vite)

This branch no longer ships the Next.js standalone image. The container runs
the **Elysia backend** (`server/`, Bun) which serves both the API and the
built dashboard (`web/dist`) on one port.

Base image: `oven/bun:1.4-alpine`. No Node.js, no Next.js in the image.

---

# 👤 For Users

## Quick start

```bash
cp .env.example .env   # set JWT_SECRET + INITIAL_PASSWORD
docker compose up -d --build
```

App listens on port `20128`. Open: http://localhost:20128

## Manage

```bash
docker logs -f 9router-plus     # view logs
docker compose stop             # stop
docker compose up -d            # start again
docker compose down             # remove (data kept in the 9router-plus-data volume)
```

## Data persistence

```bash
volumes:
  - 9router-plus-data:/app/data
environment:
  DATA_DIR: /app/data
```

Without `DATA_DIR`, the app falls back to `~/.9router-plus/` (this branch never
touches the original `~/.9router/`). In the container, `DATA_DIR=/app/data`
makes the named volume work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database (bun:sqlite driver)
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

## Optional env vars

```bash
docker run -d \
  -p 20128:20128 \
  -v 9router-plus-data:/app/data \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e JWT_SECRET=change-me-to-a-long-random-secret \
  -e INITIAL_PASSWORD=change-me \
  --name 9router-plus \
  9router-plus:elysia
```

## Optional Headroom sidecar

Same shape as before — point the app at the sidecar proxy:

```yaml
services:
  9router:
    # ...
    environment:
      DATA_DIR: /app/data
      HEADROOM_URL: http://headroom:8787
    # no depends_on — HEADROOM_URL is dialled on demand from the UI

  # Optional: docker compose --profile headroom up
  headroom:
    profiles: ["headroom"]
    image: ghcr.io/chopratejas/headroom:latest
    ports:
      - "8787:8787"
```

In the dashboard, open `Endpoint` → `Token Saver` → `Headroom`, confirm the URL
is `http://headroom:8787`, recheck status, then enable Headroom.

If Headroom runs on the Docker host instead of as a sidecar, use
`http://host.docker.internal:8787` on macOS/Windows. On Linux, add
`--add-host=host.docker.internal:host-gateway` or the equivalent compose
`extra_hosts` entry.

---

# 🛠 For Developers

## Layout

```text
server/          # Elysia backend (Bun). `bun run dev` / `bun run start`
server/vendor/   # generated: verbatim copy of src/app/api/** + dashboardGuard
web/             # dashboard SPA (Vite + pure React). `bun run dev` / `bun run build`
web/dist/        # generated: built SPA, served by the backend same-origin
src/ open-sse/   # shared engine — used live by both server and web
```

Regenerate after pulling upstream or editing sources:

```bash
cd server && bun run sync   # vendor + route manifest
cd web && bun run sync      # UI copy + next/* codemod
```

## Build image locally (test)

```bash
docker build -t 9router-plus:elysia .

docker run --rm -p 20145:20128 \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET=test-secret-0123456789abcdef \
  -e INITIAL_PASSWORD=testpass123 \
  9router-plus:elysia
```

Then: `curl localhost:20145/api/health` → `{"ok":true}`, and open
http://localhost:20145/dashboard for the UI.

## Notes

- The MITM child process spawns a Node runtime; the image is Bun-only, so
  MITM-in-Docker is unsupported (same as before — it was host-only).
- `better-sqlite3` is intentionally absent from the image; the driver chain
  uses `bun:sqlite` with the `sql.js` fallback.
