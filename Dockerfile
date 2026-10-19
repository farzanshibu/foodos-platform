# All eleven FoodOS services in one container. Build from the repo root:
#   docker build .
FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY . .
# Full workspace install: tsx (a root dev dependency) runs the TypeScript directly.
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 10000
CMD ["pnpm", "exec", "tsx", "--conditions=react-server", "deploy/all-services.ts"]
