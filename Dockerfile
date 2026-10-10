FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js index.html ./

ENV HOST=0.0.0.0 \
    CHROME_PATH=/usr/bin/chromium \
    PROFILE_DIR=/tmp/profile \
    MAX_SCALE=1 \
    CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-extensions --disable-background-networking --disable-features=site-per-process"

USER node
CMD ["node", "server.js"]
