FROM node:18.20.3-bookworm-slim

WORKDIR /app

COPY . .

EXPOSE 3333 8117

CMD ["node", "init.js", "-config=/config/config.json"]
