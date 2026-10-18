FROM node:22-alpine

WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/index.html ./index.html
COPY dashboard/vite.config.ts ./vite.config.ts
COPY dashboard/tsconfig.json ./tsconfig.json
COPY dashboard/src ./src
COPY samples /app/samples

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
