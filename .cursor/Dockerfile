# Cursor cloud-agent image. Build context is the repository root.
# Node is the version in .nvmrc. Checksums are from
# https://nodejs.org/dist/v27.0.0-alpha.0.0.0/SHASUMS256.txt
# Node bundles OpenSSL; this image does not install a separate OpenSSL.
FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils git sudo \
    && rm -rf /var/lib/apt/lists/*

COPY .nvmrc /tmp/.nvmrc
RUN set -eu; \
    version="$(tr -d '[:space:]' < /tmp/.nvmrc)"; \
    test "$version" = "27.0.0-alpha.0.0.0"; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64) node_arch=linux-x64; sha=f1e9f7f2deef9797f9106781d097649b99df2a473e1fd3f97b6991fa6a271f4f ;; \
      aarch64) node_arch=linux-arm64; sha=348be53d6a3d6d41ba147d88743cc842777ac1a1efec56a8dc56128b27e69b9f ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${version}/node-v${version}-${node_arch}.tar.xz" -o /tmp/node.tar.xz; \
    echo "${sha}  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
    rm -f /tmp/node.tar.xz /tmp/.nvmrc; \
    test "$(/usr/local/bin/node -p 'process.versions.node')" = "$version"

ENV PATH="/usr/local/bin:${PATH}"
WORKDIR /workspace
