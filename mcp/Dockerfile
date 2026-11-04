# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# The runtime only needs `node`: drop npm, npx, corepack and yarn (and their
# bundled dependencies), which are never used and only add CVEs.
RUN apk add --no-cache git tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
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
