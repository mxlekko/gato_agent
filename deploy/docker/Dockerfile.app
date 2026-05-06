FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends default-mysql-client ruby ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/logs /app/.local/runtime-bundles

ENV NODE_ENV=production

CMD ["npm", "run", "start:api"]
