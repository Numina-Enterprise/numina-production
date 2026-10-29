FROM nginx:alpine-slim

# Create dedicated non-root user for security-hardened enterprise deployment
RUN addgroup -g 10001 -S numina && \
    adduser -u 10001 -D -S -G numina numina && \
    mkdir -p /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html /etc/nginx/conf.d && \
    chown -R numina:numina /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html /etc/nginx/conf.d

# Copy web origin static assets and clean nginx configuration file
COPY --chown=numina:numina index.html /usr/share/nginx/html/index.html
COPY --chown=numina:numina style.css /usr/share/nginx/html/style.css
COPY --chown=numina:numina _headers /usr/share/nginx/html/_headers
COPY --chown=numina:numina nginx.conf /etc/nginx/conf.d/default.conf

# Forward nginx logs to standard container output for Cloud Logging
RUN ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log

# Switch to non-root execution
USER numina

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
