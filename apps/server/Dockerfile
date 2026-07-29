# Multi-stage build for the multiplayer WebSocket server.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY packages/engine/package.json ./packages/engine/
RUN npm ci
COPY packages/engine ./packages/engine
COPY apps/server ./apps/server
# Runtime uses tsx; keep sources.

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
WORKDIR /app
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "@mamba/server"]
