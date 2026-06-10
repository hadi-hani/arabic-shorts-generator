FROM node:20-alpine
RUN apk add --no-cache ffmpeg ttf-dejavu fontconfig
RUN fc-cache -fv
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
RUN mkdir -p output temp
EXPOSE 3001
CMD ["node", "server.js"]
