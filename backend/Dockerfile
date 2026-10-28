FROM node:22-alpine AS contracts
WORKDIR /chain
COPY blockchain/package.json blockchain/package-lock.json ./
RUN npm ci
COPY blockchain/hardhat.config.js ./
COPY blockchain/contracts ./contracts
COPY blockchain/scripts/export-dapp.js ./scripts/export-dapp.js
RUN npx hardhat compile && DAPP_BUILD_OUTPUT=/chain/dapp-build.json npx hardhat run scripts/export-dapp.js

FROM node:22-alpine AS build

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY samples /samples
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /samples /samples
COPY --from=contracts /chain/dapp-build.json /app/dapp-build.json
ENV DAPP_BUILD_PATH=/app/dapp-build.json
EXPOSE 8080
CMD ["node", "dist/server.js"]
