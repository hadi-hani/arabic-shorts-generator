FROM node:20-alpine

# System dependencies
# python3 + edge-tts: Microsoft Edge TTS engine (the only engine, no API key)
RUN apk add --no-cache ffmpeg ttf-dejavu fontconfig nginx supervisor \
    font-noto font-noto-arabic ca-certificates \
    python3 py3-pip
RUN pip3 install --no-cache-dir --break-system-packages edge-tts \
    || pip3 install --no-cache-dir edge-tts
RUN fc-cache -fv

WORKDIR /app

# Install Node dependencies
COPY package.json .
RUN npm install --production

# Copy application code
COPY . .
RUN mkdir -p output temp data

# Copy nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# Copy frontend UI to nginx html directory
COPY public/index.html /usr/share/nginx/html/index.html

# Copy supervisord config
COPY supervisord.conf /etc/supervisord.conf

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
