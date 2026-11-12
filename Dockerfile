# Cloud Run image for numina-production.
# Pins Node 27.0.0-alpha.0.0.0, matching .nvmrc and the preview guard.
# This is an alpha prerelease. Node bundles OpenSSL; this image does not
# install a separate OpenSSL. Official Docker Hub has no node:27.0.0-alpha.0.0.0
# tag; the checksum-pinned tarball is config/numina-node26.v1.json.
# It does NOT run the local preview server: that server binds 127.0.0.1,
# defaults to port 8788, and ignores $PORT.
# It runs scripts/cloudrun-server.mjs, which binds 0.0.0.0:$PORT and
# forwards to the canonical Worker in dist/server/index.js.
# Build context must include dist/ (already built locally) and
# scripts/cloudrun-server.mjs. No npm install is run here: the adapter
# and the bundled Worker use Node builtins only. If a local test shows
# dist/server/index.js importing an npm package, stop and add the
# package install step before any deploy; do not deploy past that error.
FROM node:27.0.0-alpha.0.0.0
WORKDIR /app
COPY dist ./dist
COPY scripts/cloudrun-server.mjs ./scripts/cloudrun-server.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "scripts/cloudrun-server.mjs"]
