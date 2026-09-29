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
# puppeteer-core (PNG/PDF export), pptxgenjs, pdf-parse and the rest are loaded
# through gated imports and belong to a full image.
RUN npm ci --omit=dev \
  && mkdir -p /app/data /app/uploads \
  && chmod +x /app/scripts/docker-entrypoint.sh

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
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4177
ENV HOST=0.0.0.0
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

USER node

EXPOSE 4177

# The entrypoint applies pending database migrations and then execs the CMD, so
# a compose deploy needs no manual `db:migrate` step. PostgreSQL is the only
# storage backend, so this is unconditional. `docker compose exec` bypasses
# entrypoints, so one-off commands in a running container are unaffected.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]

CMD ["node", "server/server.js"]
