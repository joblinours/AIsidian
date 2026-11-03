# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache git tini
ENV NODE_ENV=production \
    HOME=/tmp \
    VAULT_DIR=/vault \
    STATE_DIR=/state \
    PORT=8080 \
    STATUS_PORT=9101
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Runs as the unprivileged "node" user (uid 1000) by default; override with `user:` in compose
# so that it matches the owner of the vault files written by the LiveSync client.
USER node
EXPOSE 8080 9101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.STATUS_PORT||9101)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
