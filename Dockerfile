# Orbit — a long-lived Next.js server, built to `output: 'standalone'`.
#
# Not a serverless bundle, on purpose: every page is `force-dynamic` and
# src/lib/db/index.ts holds a Postgres connection pool. A pool is an asset in a
# container that lives for days and a liability in a function that lives for
# 200ms.
#
#   docker build -t orbit .
#   docker run --rm -p 3000:3000 \
#     -e DATABASE_URL=postgres://orbit_app:…@db.…:5432/postgres \
#     -e AUTH_PROVIDER=supabase \
#     -e SUPABASE_URL=https://….supabase.co \
#     -e SUPABASE_ANON_KEY=… \
#     -e APP_URL=https://orbit.example.com \
#     orbit
#
# Nothing here has been deployed. It builds; it has never been run against a
# real Supabase project, because there is not one. See docs/deploy.md.

# --- dependencies ----------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- build -----------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build needs no database and no credential: every page is dynamic, so
# nothing is rendered at build time and nothing here connects to anything.
RUN pnpm build

# --- run -------------------------------------------------------------------
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Not root. The server needs to read its own files and open a socket, and
# nothing else.
RUN useradd --system --uid 1001 --create-home orbit
USER orbit

COPY --from=build --chown=orbit:orbit /app/.next/standalone ./
COPY --from=build --chown=orbit:orbit /app/.next/static ./.next/static
# There is no public/ directory in this repository; if one is ever added, copy
# it here too or its files will 404 in the image and nowhere else.

EXPOSE 3000
CMD ["node", "server.js"]
