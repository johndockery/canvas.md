FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY tsconfig.json ./

# Data directory for SQLite
RUN mkdir -p /data
VOLUME /data
ENV DATABASE_PATH=/data/canvas.db

EXPOSE 1234 1235

CMD ["npx", "tsx", "server/index.ts"]
