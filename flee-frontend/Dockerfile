FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY src ./src

EXPOSE 4173

CMD ["npm", "start"]
