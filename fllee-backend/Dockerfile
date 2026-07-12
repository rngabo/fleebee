FROM node:22-bookworm-slim

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY fllee-backend/package.json fllee-backend/package-lock.json fllee-backend/prisma.config.ts ./
COPY fllee-backend/prisma ./prisma

RUN npm ci --omit=dev \
  && npx prisma generate

COPY fllee-backend/server.js ./
COPY fllee-backend/scripts ./scripts
COPY fllee-backend/src ./src
COPY fllee-backend/docker ./docker
COPY flee-frontend/public ./public

EXPOSE 4100

CMD ["sh", "./docker/backend-entrypoint.sh"]
