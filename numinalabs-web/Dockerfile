FROM nginx:alpine-slim

# Copy web files
COPY index.html /usr/share/nginx/html/index.html
COPY style.css /usr/share/nginx/html/style.css

# Configure strict security headers
RUN echo 'server { \
    listen 8080; \
    server_name localhost numinalabs.xyz www.numinalabs.xyz; \
    root /usr/share/nginx/html; \
    index index.html; \
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always; \
    add_header X-Content-Type-Options "nosniff" always; \
    add_header X-Frame-Options "DENY" always; \
    add_header Referrer-Policy "strict-origin-when-cross-origin" always; \
    add_header Content-Security-Policy "default-src '\''self\'\'; style-src '\''self'\'' '\''unsafe-inline\'\'; img-src '\''self'\'' data: https:; script-src '\''self\'\'; font-src '\''self'\'' data:; connect-src '\''self'\'' https://xyz.numinalabs.app https://api.stripe.com;" always; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
