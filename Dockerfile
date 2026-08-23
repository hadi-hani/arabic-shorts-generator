# Stage 1: install node dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package.json .
RUN npm install --production

# Stage 2: final image
# glibc base (Debian) is REQUIRED: torch / kokoro ship only manylinux wheels,
# which do not install on Alpine (musl). Python 3.11 here also lets
# kokoro's curated-tokenizers build cleanly.
FROM node:20-bookworm

# System dependencies: nginx, ffmpeg, supervisor, Arabic fonts, CA certificates,
# python3 for edge-tts / kokoro(Nabra) / piper, git for the kokoro pip fork.
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx ffmpeg fontconfig supervisor ca-certificates \
        fonts-noto-core fonts-noto-arabic \
        python3 python3-pip python3-venv git espeak-ng \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# Python TTS deps. CPU-only torch keeps the image smaller.
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip3 install --no-cache-dir \
        "kokoro @ git+https://github.com/Oddadmix/kokoro.git@main" \
        soundfile huggingface_hub misaki \
        edge-tts piper-tts faster-whisper

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
