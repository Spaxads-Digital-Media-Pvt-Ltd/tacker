# Tracker api-backend — one image, many entrypoints (each surface runs as its own container
# via a different `command`, so they scale independently — spec §2 containerization).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Default command is a placeholder; docker-compose / orchestrator overrides per surface
# (start:dashboard | start:tracking | start:public-api | start:platform-admin | start:workers).
CMD ["node", "dist/surfaces/dashboard/main.js"]
