FROM node:22-bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    libboost-date-time-dev \
    libboost-system-dev \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/patch-native-addons.js scripts/patch-native-addons.js

# The native hashing dependencies need the repository's compatibility patches
# before they can be compiled on current Node.js.
RUN npm ci --ignore-scripts \
  && npm run patch-addons \
  && npm cache clean --force

COPY . .

EXPOSE 8117 3333 5555 7777

CMD ["node", "init.js", "-config=/config/config.json"]
