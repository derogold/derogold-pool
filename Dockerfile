FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        g++ \
        git \
        libboost-all-dev \
        make \
        python3 \
    && npm install -g node-gyp \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN node scripts/patch-native-addons.js

EXPOSE 3333 8117

CMD ["node", "init.js", "-config=/config/config.json"]
