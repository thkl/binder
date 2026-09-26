# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/worker/package.json packages/worker/package.json

RUN pnpm install --frozen-lockfile

COPY packages ./packages

RUN pnpm build
RUN pnpm deploy --filter @binder/api --prod /out/api
RUN pnpm deploy --filter @binder/worker --prod /out/worker

FROM node:24-bookworm-slim AS api

ENV NODE_ENV=production
ENV CLIENT_PATH=/app/client
ENV DOCUMENT_STORAGE_ROOT=/data/storage
WORKDIR /app

COPY --from=builder /out/api ./
COPY --from=builder /workspace/packages/client/dist/client ./client

RUN mkdir -p /data/storage /app/logs

EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM node:24-bookworm-slim AS worker

ENV NODE_ENV=production
ENV DOCUMENT_STORAGE_ROOT=/data/storage
WORKDIR /app

COPY --from=builder /out/worker ./

RUN mkdir -p /data/storage /app/logs

CMD ["node", "dist/main.js"]
