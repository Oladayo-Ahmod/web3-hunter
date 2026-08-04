# Production image for apps/web, using Turborepo's `prune` to build a
# minimal, deployable subset of this monorepo and Next.js's standalone
# output to keep the final image small.

FROM node:24-alpine AS base
RUN corepack enable

# 1. Prune the monorepo down to only what @web3-hunter/web needs to build.
FROM base AS pruner
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .
RUN npx turbo prune @web3-hunter/web --docker

# 2. Install dependencies for the pruned workspace, then build.
FROM base AS installer
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@web3-hunter/web

# 3. Copy only the standalone server output into a minimal runtime image.
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
