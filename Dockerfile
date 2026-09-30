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
RUN pnpm deploy --legacy --filter @binder/api --prod /out/api
RUN pnpm deploy --legacy --filter @binder/worker --prod /out/worker
RUN rm -rf /out/api/node_modules/@binder/common \
  && mkdir -p /out/api/node_modules/@binder/common \
  && cp /workspace/packages/common/package.json /out/api/node_modules/@binder/common/package.json \
  && cp -R /workspace/packages/common/dist /out/api/node_modules/@binder/common/dist

FROM node:24-bookworm-slim AS api

ENV NODE_ENV=production
ENV APP_ROOT_PATH=/app
WORKDIR /app

COPY --from=builder /out/api ./
COPY --from=builder /workspace/packages/api/migrations ./migrations
COPY --from=builder /workspace/packages/client/dist/client ./client

RUN mkdir -p /app/storage /app/logs

EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM node:24-bookworm-slim AS worker

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    clamav \
    curl \
    ghostscript \
    gnupg \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl --fail --silent --show-error --location \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && pg_dump --version \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV APP_ROOT_PATH=/app
WORKDIR /app

COPY --from=builder /out/worker ./
COPY docker/clamav/clamdscan.conf ./clamdscan.conf

RUN mkdir -p /app/storage /app/logs

CMD ["node", "dist/main.js"]
