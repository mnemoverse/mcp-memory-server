# syntax=docker/dockerfile:1
#
# Container image for the Mnemoverse Memory MCP server (stdio).
# Used by the Docker MCP Catalog / Toolkit and for self-hosted `docker run -i`.
# The server reads its API key from the MNEMOVERSE_API_KEY env var.

# ─── build stage: compile TypeScript → dist/ ──────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Compile TypeScript directly (the repo's `npm run build` also regenerates
# distribution configs via a prebuild hook that needs README/docs — irrelevant
# to the runtime image, so we run tsc straight).
RUN npx tsc

# ─── runtime stage: prod deps + compiled output only ─────────────────────────
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# MCP stdio server — Claude / Docker MCP Toolkit run it with `-i` and pipe stdio.
ENTRYPOINT ["node", "dist/index.js"]
