 # ---- Build/Test stage (optional test) ---
FROM node:18-alpine AS build
 WORKDIR /app
 COPY package*.json ./
 RUN npm ci
 COPY . .
 # If you have tests, uncomment the next line:
 # RUN npm test
 # ---- Runtime stage ---
FROM node:18-alpine
 WORKDIR /app
 ENV NODE_ENV=production
 COPY --from=build /app/package*.json ./
 RUN npm ci --omit=dev
 COPY --from=build /app ./
 EXPOSE 8000
 CMD ["node", "src/server.js"]