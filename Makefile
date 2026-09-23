# 9router+ — Elysia backend (server/) + pure-React dashboard (web/).
# Run `make help` to list everything. All comments are the docs.

SHELL := /bin/bash
PORT ?= 20128
HOSTNAME ?= 127.0.0.1
DATA_DIR ?= $(HOME)/.9router-plus
TEST_PORT ?= 20145
IMAGE ?= 9router-plus:elysia
CONTAINER ?= 9router-plus

# Sandbox for smoke tests — never touches the live gateway or real data dir.
SMOKE_HOME ?= /tmp/9r-smoke/home
SMOKE_DATA ?= /tmp/9r-smoke/data

.PHONY: help
help: ## Show this list (default target).
	@grep -E '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── setup ────────────────────────────────────────────────────────────────
.PHONY: install
install: ## Install all deps (root engine + server + web).
	bun install
	cd server && bun install
	cd web && bun install

.PHONY: install-test
install-test: ## Install the independent vitest suite deps (tests/).
	cd tests && npm install

# ── codegen ──────────────────────────────────────────────────────────────
.PHONY: sync sync-server sync-web
sync: sync-server sync-web ## Regenerate vendored API + UI copies.

sync-server: ## Copy src/app/api to server/vendor + rebuild route manifest.
	cd server && bun run sync

sync-web: ## Copy dashboard UI to web/src + apply next/* codemod.
	cd web && bun run sync

.PHONY: registry
registry: ## Regenerate the open-sse provider registry index (after adding a provider).
	node scripts/migrate-registry.mjs
	node scripts/injectDisplayToRegistry.mjs

# ── dev ──────────────────────────────────────────────────────────────────
.PHONY: dev dev-server dev-web
dev: sync ## Run backend + dashboard dev servers (Ctrl-C stops both).
	@trap 'kill $$SERVER_PID 2>/dev/null' EXIT; \
	cd server && PORT=$(PORT) HOSTNAME=$(HOSTNAME) DATA_DIR=$(DATA_DIR) bun run dev & SERVER_PID=$$!; \
	cd web && PORT=$(PORT) bun run dev

dev-server: sync-server ## Run the Elysia backend with hot reload.
	cd server && PORT=$(PORT) HOSTNAME=$(HOSTNAME) DATA_DIR=$(DATA_DIR) bun run dev

dev-web: sync-web ## Run the Vite dashboard (proxies /api to PORT).
	cd web && PORT=$(PORT) bun run dev

# ── production (native) ──────────────────────────────────────────────────
.PHONY: build start preview
build: ## Build the dashboard SPA into web/dist.
	cd web && bun run build

start: sync build ## Boot the production server (serves API + web/dist).
	cd server && PORT=$(PORT) HOSTNAME=$(HOSTNAME) DATA_DIR=$(DATA_DIR) bun run start

preview: ## Preview the built SPA without the backend.
	cd web && bun run preview

.PHONY: keygen
keygen: ## Print fresh JWT_SECRET / API_KEY_SECRET values for .env.
	@bun -e 'import { randomBytes } from "node:crypto"; \
		console.log("JWT_SECRET=" + randomBytes(32).toString("hex")); \
		console.log("API_KEY_SECRET=" + randomBytes(32).toString("hex")); \
		console.log("MACHINE_ID_SALT=" + randomBytes(16).toString("hex"));'

# ── tests & lint ─────────────────────────────────────────────────────────
.PHONY: test test-baseline lint
test: ## Run the vitest suite (see tests/__baseline__ — not all-green on checkout).
	cd tests && npx vitest run

test-baseline: ## Compare test results against the committed no-regression baseline.
	node tests/__baseline__/verify-no-regression.mjs

lint: ## Lint the repo (Next-flavoured eslint config).
	npx eslint .

# ── docker ───────────────────────────────────────────────────────────────
.PHONY: docker-build docker-run docker-stop docker-smoke
docker-build: ## Build the production oven/bun image.
	docker build -t $(IMAGE) .

docker-run: ## Run the image on TEST_PORT (defaults to 20145, avoids the live gateway).
	docker run --rm --name $(CONTAINER)-test -d -p $(TEST_PORT):20128 \
		-e DATA_DIR=/app/data \
		-e JWT_SECRET=test-secret-0123456789abcdef \
		-e INITIAL_PASSWORD=testpass123 \
		$(IMAGE)

docker-stop: ## Stop and remove the test container.
	docker rm -f $(CONTAINER)-test

docker-smoke: docker-run ## Boot the container and verify health, login, UI, rewrite parity.
	@for i in $$(seq 1 30); do \
		curl -sf 127.0.0.1:$(TEST_PORT)/api/health >/dev/null && break || sleep 2; done; \
	curl -sf 127.0.0.1:$(TEST_PORT)/api/health | grep -q '"ok":true' && echo "health: OK"; \
	curl -sf -o /dev/null -w "login: %{http_code}\n" -X POST 127.0.0.1:$(TEST_PORT)/api/auth/login \
		-H 'content-type: application/json' -d '{"password":"testpass123"}'; \
	curl -sf -o /dev/null -w "dashboard: %{http_code}\n" 127.0.0.1:$(TEST_PORT)/dashboard; \
	curl -sf 127.0.0.1:$(TEST_PORT)/v1/models -o /tmp/9r-m1.json; \
	curl -sf 127.0.0.1:$(TEST_PORT)/api/v1/models -o /tmp/9r-m2.json; \
	cmp -s /tmp/9r-m1.json /tmp/9r-m2.json && echo "rewrite parity: OK"; \
	$(MAKE) docker-stop

.PHONY: compose-up compose-down compose-logs compose-build
compose-up: ## Start the production stack (app + headroom sidecar).
	docker compose up -d --build --force-recreate

compose-down: ## Stop the stack (named volume keeps data).
	docker compose down

compose-logs: ## Follow app logs.
	docker compose logs -f 9router

compose-build: ## Rebuild the compose image without starting.
	docker compose build

# ── native smoke test ────────────────────────────────────────────────────
.PHONY: smoke
smoke: ## Boot production on a scratch port with sandbox data and verify it.
	@rm -rf $(SMOKE_HOME) $(SMOKE_DATA); mkdir -p $(SMOKE_HOME) $(SMOKE_DATA)
	cd server && PORT=$(TEST_PORT) HOSTNAME=127.0.0.1 HOME=$(SMOKE_HOME) DATA_DIR=$(SMOKE_DATA) \
		JWT_SECRET=test-secret-0123456789abcdef INITIAL_PASSWORD=testpass123 NODE_ENV=production \
		bun run start > /tmp/9r-smoke.log 2>&1 & SRV=$$!; \
	for i in $$(seq 1 30); do \
		curl -sf 127.0.0.1:$(TEST_PORT)/api/health >/dev/null && break || sleep 2; done; \
	B=http://127.0.0.1:$(TEST_PORT); \
	curl -sf $$B/api/health | grep -q '"ok":true' && echo "health: OK"; \
	curl -sf -c /tmp/9r-smoke.jar -o /dev/null -w "login: %{http_code}\n" -X POST $$B/api/auth/login \
		-H 'content-type: application/json' -d '{"password":"testpass123"}'; \
	curl -sf -b /tmp/9r-smoke.jar -o /dev/null -w "settings: %{http_code}\n" $$B/api/settings; \
	curl -sf -o /dev/null -w "dashboard-anon: %{http_code}\n" $$B/dashboard; \
	curl -sf -b /tmp/9r-smoke.jar -o /dev/null -w "dashboard-authed: %{http_code}\n" $$B/dashboard; \
	kill $$SRV 2>/dev/null; wait $$SRV 2>/dev/null; \
	lsof -tiTCP:$(TEST_PORT) | xargs kill 2>/dev/null; true

# ── cli launcher package ─────────────────────────────────────────────────
.PHONY: cli-dev cli-pack
cli-dev: ## Watch-run the 9router CLI launcher package.
	cd cli && npm run dev

cli-pack: ## Build + npm-pack the CLI launcher.
	npm run cli:pack

# ── cleanup ──────────────────────────────────────────────────────────────
.PHONY: clean docker-clean
clean: ## Remove generated trees (vendor, dist, manifests — all regenerable).
	rm -rf web/dist server/vendor server/src/routes-manifest.ts

docker-clean: ## Remove the built image.
	docker rmi $(IMAGE)
