# Stage 1: install node dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package.json .
RUN npm install --production

# Stage 2: final image
FROM node:20-alpine

# Install nginx, ffmpeg, supervisor, fonts
RUN apk add --no-cache nginx ffmpeg ttf-dejavu fontconfig supervisor && fc-cache -fv

WORKDIR /app

# Copy backend
COPY --from=deps /app/node_modules ./node_modules
COPY backend/server.js .
COPY backend/services/ ./services/
RUN mkdir -p output temp

# Copy frontend static files
COPY frontend/ /usr/share/nginx/html/

# Copy configs
COPY backend/nginx.conf /etc/nginx/http.d/default.conf
COPY backend/supervisord.conf /etc/supervisord.conf

RUN rm -f /etc/nginx/http.d/default.conf.bak 2>/dev/null || true

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
