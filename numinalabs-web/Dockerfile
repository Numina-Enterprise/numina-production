# Multi-Cloud Container Alignment Specification
# Supported Platforms:
#  1. Google Cloud Run (project-0317d6c9-e943-409e-83f)
#  2. IBM Cloud Code Engine / IKS (cloud.ibm.com)
#  3. Local Docker Swarm / Container Test Harness

FROM nginx:alpine-slim

# Create dedicated non-root user for security-hardened enterprise deployment
RUN addgroup -g 10001 -S numina && \
    adduser -u 10001 -D -S -G numina numina && \
    mkdir -p /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html && \
    chown -R numina:numina /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html

# Copy web origin static assets
COPY --chown=numina:numina index.html /usr/share/nginx/html/index.html
COPY --chown=numina:numina style.css /usr/share/nginx/html/style.css
COPY --chown=numina:numina _headers /usr/share/nginx/html/_headers

# Configure NGINX for Cloud Run (port 8080) & IBM Code Engine (configurable via PORT env)
RUN echo 'server { \
    listen 8080 default_server; \
    listen [::]:8080 default_server; \
    server_name localhost numinalabs.xyz www.numinalabs.xyz; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # 2-Year HSTS Preload Compliance \
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always; \
    add_header X-Content-Type-Options "nosniff" always; \
    add_header X-Frame-Options "DENY" always; \
    add_header Referrer-Policy "strict-origin-when-cross-origin" always; \
    add_header Content-Security-Policy "default-src '\''self\'\'; style-src '\''self'\'' '\''unsafe-inline\'\'; img-src '\''self'\'' data: https:; script-src '\''self\'\'; font-src '\''self'\'' data:; connect-src '\''self'\'' https://xyz.numinalabs.app https://api.stripe.com;" always; \
    \
    # Health probe endpoint for GCP Cloud Run & IBM Code Engine \
    location /healthz { \
        access_log off; \
        return 200 "OK\n"; \
    } \
    \
    # Canonical route handling \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Forward nginx logs to standard container output for Cloud Logging
RUN ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log

# Switch to non-root execution
USER numina

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
