# Orbit

Orbit is a static, browser-first household organiser. The Vite application talks directly to Supabase with the signed-in user’s JWT; the existing `orbit` Row Level Security policies remain the authorisation boundary.

## Architecture

- Vite + React + strict TypeScript single-page application in `client/`
- React Router for URL-owned navigation, ranges, filters and selection
- TanStack Query for remote state, caching, optimistic mutations and precise invalidation
- one `@supabase/supabase-js` browser client in `client/lib/supabase.ts`
- direct CRUD and narrow browser RPCs in the single exposed `orbit` schema
- CSS Modules plus global semantic tokens/reset; explicit light and dark palettes
- MapLibre loaded only after opening the Places map tab
- static hosting with SPA fallback; no application server, service worker, realtime subscription or service-role browser path

## Local setup

Requires Node 22+ and pnpm.

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Set only:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

The publishable key is intended for browser use. Never expose the service-role key through `VITE_*` or any client source.

## Supabase project setup

1. Apply migrations in lexical order. Do not rewrite or skip existing migrations.
2. In **Supabase Dashboard → Data API → Exposed schemas**, add `orbit`. Do not expose the internal `app` schema.
3. In **Authentication → URL Configuration**, set the deployed Site URL and allow these redirect URLs:
   - `http://localhost:5173/auth/callback`
   - `https://YOUR_ORIGIN/auth/callback`
4. Enable email/password and magic-link email authentication as required by the project.

The application uses normal Supabase session persistence, PKCE callback detection and automatic refresh. New users receive profiles and default spaces through the existing database triggers/wrappers.

## Database migrations

The original migrations `0000`–`0017`, their tables, data, policies, seed and pgTAP suites remain unchanged.

- `0018_browser_api.sql` adds least-privilege browser wrappers to `orbit`; the internal `app` schema remains unexposed.
- `0019_browser_preferences.sql` adds cross-device `theme` and `default_space_id` profile preferences.
- `0020_browser_dashboard.sql` combines the measured three-request Today payload into one security-invoker RPC. It does not bypass RLS.
- `0021_browser_search.sql` combines the measured five-request global search into one security-invoker RPC. Locked rows remain excluded and RLS still filters every branch.

For the existing plain-Postgres harness:

```sh
pnpm db:reset
pnpm db:test
```

Those scripts require PostgreSQL 16, PostGIS, pgvector and pgTAP. They rebuild only the explicitly configured local `ORBIT_DB_NAME` database.

## Tests

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Playwright defines Chromium, Firefox and WebKit projects. Install their binaries once where needed:

```sh
pnpm exec playwright install chromium firefox webkit
```

The browser suite uses mocked Data API responses for deterministic responsive and keyboard checks. A real-project release pass must additionally cover sign-up, password sign-in, magic link, refresh across token expiry, sign-out, invitations and two-account RLS isolation.

## Static deployment

Publish `dist/` after `pnpm build`. `public/_redirects` and `vercel.json` provide equivalent SPA fallbacks for common static hosts; configure the platform to return `index.html` for unknown non-asset paths.

No server process, Docker image, direct Postgres connection or middleware is required.

## Deferred intentionally

- AI/LLM features and consent UI
- rules, scheduler, reminders and push delivery
- Google/ICS sync and other external providers
- geocoding, travel estimates and travel mode
- custom service worker, offline write queue, devices and conflict UI
- creation/editing of encrypted records (existing locked records render as unavailable)
- realtime subscriptions

The underlying database tables for deferred capabilities are retained unchanged.
