FROM node:20-alpine

# System dependencies
RUN apk add --no-cache ffmpeg ttf-dejavu fontconfig nginx supervisor
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

# Copy supervisord config
COPY supervisord.conf /etc/supervisord.conf

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
