# --- build stage: install production deps (better-sqlite3 is a native module) ---
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# Build toolchain in case a prebuilt better-sqlite3 binary isn't available.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime stage ----------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Persist the SQLite DB and uploads outside the image layer. Mount a volume here.
ENV DATA_DIR=/data
RUN mkdir -p /data/uploads && chown -R node:node /data
VOLUME ["/data"]

ENV PORT=4000
EXPOSE 4000
USER node
CMD ["node", "server.js"]
