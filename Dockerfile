FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN npm ci --workspaces

# Build shared types
COPY packages/shared ./packages/shared
RUN npm run build -w @freellmapi/shared

# Build API
COPY apps/api ./apps/api
RUN cd apps/api && npx prisma generate --schema=prisma/schema.prisma
RUN npm run build -w @freellmapi/api 2>/dev/null || true

# Build dashboard
COPY apps/dashboard ./apps/dashboard
RUN npm run build -w @freellmapi/dashboard

# Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/api ./apps/api
COPY --from=base /app/apps/dashboard/dist ./apps/dashboard/dist

# Serve dashboard static files from the API server
RUN mkdir -p /app/apps/api/public && cp -r /app/apps/dashboard/dist/* /app/apps/api/public/

EXPOSE 3001

CMD ["node", "-e", "require('@prisma/client'); process.chdir('/app/apps/api'); require('./src/index.ts')" ]
