FROM node:20-alpine

WORKDIR /app

# PNG export (server-side): install chromium runtime for puppeteer-core
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont

# Install only production deps (there are currently none, but this keeps Docker builds stable if you add deps later)
COPY package.json package-lock.json* ./
# `npm install` triggers `postinstall`, which needs this script present.
COPY scripts/vendor-lucide.js ./scripts/vendor-lucide.js
COPY shared/icon-names.js ./shared/icon-names.js
RUN npm install --omit=dev || npm install

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=4177
ENV HOST=0.0.0.0
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 4177

CMD ["node", "server/server.js"]


