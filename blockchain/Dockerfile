FROM ghcr.io/foundry-rs/foundry:v1.8.1@sha256:0c00cb0bda1ab1b91c9a6bf60f4c76c09c1a8870824b6d4718afbabacf6f9a17 AS foundry
FROM node:22-bookworm-slim

COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY hardhat.config.js ./
COPY contracts ./contracts
COPY scripts ./scripts
RUN npm run compile

RUN mkdir -p /data
CMD ["anvil", "--host", "0.0.0.0", "--chain-id", "31337", "--accounts", "20", "--silent", "--state", "/data/chain.json", "--state-interval", "1", "--preserve-historical-states"]
