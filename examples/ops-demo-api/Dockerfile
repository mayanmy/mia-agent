FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3100

USER node

EXPOSE 3100

CMD ["node", "src/server.mjs"]
