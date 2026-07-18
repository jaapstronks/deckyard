FROM node:22-alpine

WORKDIR /app

# PNG/PDF export (server-side): install chromium runtime for puppeteer-core.
# `chromium-chromedriver` is not needed; `chromium` ships the sandbox helper so
# the browser can run with its own sandbox enabled under a non-root user.
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont

# App source first: `npm install` runs a `postinstall` (vendor-lucide +
# download-google-fonts) that reads several source files, so the full tree
# must be present before installing.
COPY . .

# Install only production deps.
RUN npm install --omit=dev || npm install

# Run as a non-root user. The `node` image ships an unprivileged `node`
# user (uid 1000); give it ownership of the app dir so runtime writes
# (uploads, data/) succeed. A renderer compromise then lands as `node`,
# not root. See docs/plans/security-hardening.md item 1.
RUN mkdir -p /app/data /app/uploads \
  && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=4177
ENV HOST=0.0.0.0
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

USER node

EXPOSE 4177

CMD ["node", "server/server.js"]
