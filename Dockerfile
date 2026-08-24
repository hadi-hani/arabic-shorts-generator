# Stage 1: install node dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package.json .
RUN npm install --production

# Stage 2: final image
# glibc base (Debian): faster-whisper (ctranslate2) ships manylinux wheels only.
FROM node:20-bookworm

# System dependencies: nginx, ffmpeg, supervisor, Arabic fonts, CA certificates,
# python3 for edge-tts / faster-whisper fallback alignment.
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx ffmpeg fontconfig supervisor ca-certificates \
        fonts-noto-core fonts-noto-arabic \
        python3 python3-pip python3-venv \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# Python deps: Edge TTS engine + optional whisper forced-alignment fallback.
RUN pip3 install --no-cache-dir edge-tts faster-whisper

WORKDIR /app

# Copy backend
COPY --from=deps /app/node_modules ./node_modules
COPY backend/server.js .
COPY backend/services/ ./services/
COPY backend/fonts/ ./fonts/
COPY backend/public/ /usr/share/nginx/html/
RUN mkdir -p output temp data

# Copy configs
COPY backend/nginx.conf /etc/nginx/http.d/default.conf
COPY backend/supervisord.conf /etc/supervisord.conf

# Clean up potential nginx leftover
RUN rm -f /etc/nginx/http.d/default.conf.bak 2>/dev/null || true

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
