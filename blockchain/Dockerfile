FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY hardhat.config.js ./
COPY contracts ./contracts
COPY scripts ./scripts

CMD ["npx", "hardhat", "node", "--hostname", "0.0.0.0"]
