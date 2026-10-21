FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmjs.org
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
RUN mkdir -p /app/data/uploads && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/boot.js"]
