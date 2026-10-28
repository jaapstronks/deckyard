# Two stages keep the npm cache and the install's scratch files out of the
# image: `deps` installs the production dependencies (and runs the postinstall
# vendoring), the runtime stage copies the finished tree in once, already owned
# by `node`. A `chown -R` in a layer of its own would store the whole app a
# second time (~500 MB).
FROM node:22-alpine AS deps

WORKDIR /app

# App source first: `npm ci` runs a `postinstall` (vendor-lucide +
# download-google-fonts) that reads several source files, so the full tree
# must be present before installing.
COPY . .

# Production dependencies exactly as locked. `optionalDependencies` stay in:
# puppeteer-core (PNG/PDF export), pptxgenjs and the rest are loaded
# through gated imports and belong to a full image.
#
# The two directories the server writes, at the paths it uses without
# UPLOADS_DIR or DATA_DIR (`server/config/storage-paths.js`). `.dockerignore`
# keeps the checkout's copies out, so they are made here: a volume mounted on a
# path the image has takes the image's owner (`node`), one on a path it lacks
# is created root-owned and unwritable for the server.
RUN npm ci --omit=dev \
  && mkdir -p /app/server/data /app/server/uploads \
  && chmod +x /app/scripts/docker-entrypoint.sh

# The renderer this image publishes with, frozen into one content-addressed
# bundle (docs/reference/renderer-bundle.md). Built on top of `deps`, so the
# vendored highlighter bytes it hashes are the ones the image serves. The
# closure scanner is a dev dependency: this stage installs the locked tree
# with it, and only the finished store reaches the runtime stage. An operator
# exports it to the runner host and registers it after every release
# (scripts/export-renderer-bundle.sh, docs/ops/renderer-runner.md).
FROM deps AS renderer-bundle
RUN npm ci --ignore-scripts --no-audit --no-fund \
  && node scripts/build-renderer-bundle.js --store /renderer-store

FROM node:22-alpine

# PNG/PDF export (server-side): install chromium runtime for puppeteer-core.
# `chromium-chromedriver` is not needed; `chromium` ships the sandbox helper so
# the browser can run with its own sandbox enabled under a non-root user.
# `font-noto-emoji`: without a colour emoji font an emoji in a slide exports as
# tofu (or a stray glyph from a fallback face) in PNG, PDF and PPTX.
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  font-noto-emoji

# Run as a non-root user. The `node` image ships an unprivileged `node`
# user (uid 1000); it owns the app dir so runtime writes (uploads, data/)
# succeed. A renderer compromise then lands as `node`, not root.
# The COPY creates /app itself, so the directory is `node`'s too; a WORKDIR
# before it would leave /app owned by root.
COPY --from=deps --chown=node:node /app /app
# Root-owned and read-only for the server: the doctor reads its hash, nothing
# writes it (`server/render/renderer-bundle/current.js`).
COPY --from=renderer-bundle /renderer-store /app/renderer-store
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4177
ENV HOST=0.0.0.0
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

USER node

EXPOSE 4177

# An orchestrator (Docker, Coolify, compose `depends_on: service_healthy`)
# learns from this when the container serves, without its own configuration.
# `/health` answers before auth and touches no database. Node's own fetch, so
# the check needs nothing beyond the runtime (busybox `wget` is there too, and
# platform checks like Coolify's use it); PORT is the one the server binds.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4177) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# The entrypoint applies pending database migrations and then execs the CMD, so
# a compose deploy needs no manual `db:migrate` step. PostgreSQL is the only
# storage backend, so this is unconditional. `docker compose exec` bypasses
# entrypoints, so one-off commands in a running container are unaffected.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]

CMD ["node", "server/server.js"]
