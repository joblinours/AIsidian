# syntax=docker/dockerfile:1
# Build context: repository root (the server reuses mcp/src).
FROM node:22-alpine AS build
WORKDIR /build
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
# mcp/package.json carries "type": "module": without it tsc would emit mcp/src as CommonJS.
COPY mcp/package.json mcp/
COPY mcp/src mcp/src
COPY web web
# mcp/src resolves its npm dependencies by walking up from /build/mcp: point it at web's.
RUN ln -s /build/web/node_modules /build/node_modules \
 && cd web && npm run build && npm prune --omit=dev

FROM node:22-alpine
# The runtime only needs `node` and git: drop npm, npx, corepack and yarn.
RUN apk add --no-cache git tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    HOME=/tmp \
    VAULT_DIR=/vault \
    STATE_DIR=/state \
    ACCOUNT_FILE=/mcp-state/account.json \
    PORT=8090
WORKDIR /app
COPY --from=build /build/web/node_modules ./node_modules
COPY --from=build /build/web/dist ./dist
COPY web/package.json ./
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/web/server/main.js"]
