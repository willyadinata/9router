# 9router+ (Elysia + Bun + Vite) — replaces the Next.js standalone image.
# syntax=docker/dockerfile:1.7
ARG ALPINE_MIRROR=dl-cdn.alpinelinux.org
ARG APP_VERSION=unknown
ARG BUN_IMAGE=oven/bun:1.4.2-alpine
FROM ${BUN_IMAGE} AS base
ARG ALPINE_MIRROR
WORKDIR /app

RUN if [ "$ALPINE_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${ALPINE_MIRROR}|g" /etc/apk/repositories; \
    fi

FROM base AS deps
# No toolchain: better-sqlite3 is optional (prebuild or skip) — bun:sqlite and
# sql.js cover the runtime. Keeps the build fast on constrained links.
COPY package.json ./
COPY server/package.json server/bun.lock ./server/
COPY web/package.json web/bun.lock ./web/
# Runtime image only needs the engine deps — prune Next.js, the React
# dashboard libs, and unused middleware from the root manifest (versions stay
# pinned to the root package.json; fresh resolve since the set differs).
# wreq-js + playwright-core are devDependencies that lazyRuntime.js loads on
# demand; baking them here keeps the image offline-capable and skips the
# runtime npm install path (#5245).
RUN bun -e 'const p = await Bun.file("package.json").json(); const keep = ["@node-saml/node-saml","ajv","bcryptjs","chalk","confbox","jose","node-forge","open","ora","socks-proxy-agent","sql.js","undici","uuid"]; const lazy = ["playwright-core","wreq-js"]; const available = { ...(p.dependencies || {}), ...(p.optionalDependencies || {}), ...(p.devDependencies || {}) }; p.dependencies = Object.fromEntries(Object.entries(available).filter(([k]) => keep.includes(k) || lazy.includes(k))); delete p.devDependencies; delete p.optionalDependencies; await Bun.write("package.json", JSON.stringify(p, null, 2));'
RUN bun install
RUN cd server && bun install --frozen-lockfile
RUN cd web && bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY package.json bun.lock ./
COPY server ./server
COPY web ./web
COPY src ./src
COPY open-sse ./open-sse
COPY public ./public
RUN cd web && bun run build
RUN cd server && bun run sync

FROM ${BUN_IMAGE} AS runner
ARG ALPINE_MIRROR
ARG APP_VERSION
WORKDIR /app

LABEL org.opencontainers.image.title="9router+" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/app/data

COPY package.json jsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/bun.lock server/tsconfig.json ./server/
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY src ./src
COPY open-sse ./open-sse
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/server/vendor ./server/vendor
COPY --from=builder /app/server/src/routes-manifest.ts ./server/src/routes-manifest.ts

# ffmpeg converts audio for Codex STT and local TTS.
RUN if [ "$ALPINE_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|${ALPINE_MIRROR}|g" /etc/apk/repositories; \
    fi && \
    apk add --no-cache ffmpeg && \
    mkdir -p /app/data /app/data-home && \
    chown -R bun:bun /app && \
    { ln -sf /app/data-home /home/bun/.9router 2>/dev/null || true; }

USER bun
EXPOSE 20128

WORKDIR /app/server
CMD ["bun", "run", "start"]
