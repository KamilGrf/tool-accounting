FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so Docker caches this layer until package files change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY migrations ./migrations

# Run as the unprivileged "node" user that ships with the image.
USER node
EXPOSE 3001
CMD ["node", "src/server.js"]
