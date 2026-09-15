# Supply the independently selected official Node 24 image with its actual digest.
# No mutable image tag or invented digest is selected by this candidate.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /runtime-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
USER root
WORKDIR /opt/numina
RUN mkdir -p /var/lib/numina/journal /var/lib/numina/manifests \
    && chown 1000:1000 /var/lib/numina/journal /var/lib/numina/manifests \
    && chmod 0700 /var/lib/numina/journal /var/lib/numina/manifests
COPY --from=dependencies /runtime-dependencies/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY runtime-entrypoint.mjs ./
COPY deployment.template.json ./
COPY scripts/managed-deployment.mjs scripts/validate-deployment.mjs scripts/verify-network.mjs scripts/token-artifact.mjs ./scripts/
COPY contracts/NuminaUSD.sol ./contracts/NuminaUSD.sol
COPY artifacts/NuminaUSD.json ./artifacts/NuminaUSD.json
COPY licenses/ ./licenses/
USER node:node
ENTRYPOINT ["node", "/opt/numina/runtime-entrypoint.mjs"]
CMD ["check-runtime", "/var/lib/numina/journal"]
