# Stage 1: install node dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package.json .
RUN npm install --production

# Stage 2: final image
FROM node:20-alpine

# System dependencies: nginx, ffmpeg, supervisor, Arabic fonts, CA certificates
RUN apk add --no-cache nginx ffmpeg ttf-dejavu fontconfig supervisor \
    font-noto font-noto-arabic ca-certificates && fc-cache -fv

WORKDIR /app

# Copy backend
COPY --from=deps /app/node_modules ./node_modules
COPY backend/server.js .
COPY backend/services/ ./services/
COPY backend/public/ /usr/share/nginx/html/
RUN mkdir -p output temp data

# Copy configs
COPY backend/nginx.conf /etc/nginx/http.d/default.conf
COPY backend/supervisord.conf /etc/supervisord.conf

# Clean up potential nginx leftover
RUN rm -f /etc/nginx/http.d/default.conf.bak 2>/dev/null || true

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
