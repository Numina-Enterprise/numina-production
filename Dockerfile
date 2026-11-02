# Cloud Run image for numina-production.
# New file only. Pins Node 26.13.0, matching .nvmrc 26.13.0 (Nov 1 alignment).
# It does NOT run the local preview server: that server binds 127.0.0.1,
# defaults to port 8788, ignores $PORT, and is frozen to Node 26.11.1.
# It runs scripts/cloudrun-server.mjs, which binds 0.0.0.0:$PORT and
# forwards to the canonical Worker in dist/server/index.js.
# Build context must include dist/ (already built locally) and
# scripts/cloudrun-server.mjs. No npm install is run here: the adapter
# and the bundled Worker use Node builtins only. If a local test shows
# dist/server/index.js importing an npm package, stop and add the
# package install step before any deploy; do not deploy past that error.
FROM node:26.13.0
WORKDIR /app
COPY dist ./dist
COPY scripts/cloudrun-server.mjs ./scripts/cloudrun-server.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "scripts/cloudrun-server.mjs"]
