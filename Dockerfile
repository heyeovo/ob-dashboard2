FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1


FROM base AS development-dependencies

COPY package.json package-lock.json ./
RUN npm ci


FROM base AS production-dependencies

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM base AS builder

COPY --from=development-dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build


FROM base AS runner

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    HOME=/home/cc \
    CLAUDE_CONFIG_DIR=/home/cc/.claude

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 cc \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/cc --shell /bin/bash cc \
    && mkdir -p /workspace/dashboard /workspace/haven /home/cc/.claude \
    && chown -R 10001:10001 /workspace /home/cc

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=10001:10001 package.json package-lock.json next.config.ts ./
COPY --from=builder --chown=10001:10001 /app/.next ./.next
COPY --from=builder --chown=10001:10001 /app/public ./public

USER cc

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["npm", "run", "start"]
