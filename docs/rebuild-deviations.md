# Rebuild verification notes

Date: 2026-08-21

## Decisions and deviations

- Browser tables and reviewed RPC wrappers share the single exposed `orbit` schema. The separate proposed `orbit_api` namespace was removed before deployment; RLS, `SECURITY INVOKER`, safe search paths, and per-function execute grants remain the security controls, while the implementation-only `app` schema stays unexposed.
- Global search measured five parallel entity requests. Migration `0021_browser_search.sql` reduces that to one security-invoker RPC; every branch remains RLS-scoped and locked rows remain excluded.
- The direct Today implementation measured three domain requests. Migration `0020_browser_dashboard.sql` was therefore added under the rebuild brief's measured-performance exception, reducing Today to one route payload while retaining security-invoker RLS behaviour.
- Free/busy calendar spaces use the two narrow wrappers from `0018`; a user with multiple availability-only spaces can exceed the ordinary two-request route target. This is retained for privacy correctness rather than adding a broader API surface without production measurements.
- Browser wrapper search paths in `0018` and `0020` exclude the mutable `public` schema. The pgTAP browser API test now asserts that hardening for every wrapper.
- Recurrence edits update the existing rule in place. They create a rule only when none exists, unlink it when cleared, and skip the write when the RRULE is unchanged.
- Event space changes are not exposed as a direct edit-time mutation. Access changes remain a separately managed operation so their effects can be previewed.
- Deterministic quick capture was not ported. Explicit create forms are complete and the old capture layer was coupled to obsolete server paths.
- Existing locked records are shown as unavailable. This release does not create or edit ciphertext.
- Playwright is served by `scripts/playwright-runner.mjs`, which uses Vite's API and closes the server explicitly. This avoids the Playwright-owned web server teardown hang observed on Windows.

## Verified locally

- A clean frozen offline install from `pnpm-lock.yaml` completed with pnpm 11.18.0 and official `react-router-dom` 7.18.2. `pnpm-workspace.yaml` explicitly permits only esbuild's install script.
- Strict TypeScript: pass.
- Vitest: 3 files, 7/7 tests pass.
- Production build: pass with Vite 8.2.2.
- Chromium Playwright: 9/9 pass.
- WebKit Playwright: 5 pass, 4 Chromium-only instrumentation cases skipped.
- Authenticated responsive coverage includes Today, all four task smart lists, calendar day/week/month, People, Places, Notes, Search, and Settings at 390, 768, 1024, and 1440 pixels with no horizontal overflow.
- Keyboard coverage checks visible focus, command-palette focus containment, Escape close, and focus restoration in Chromium and WebKit.
- The measured routes each make at most one domain request: Today, Tasks, Calendar, People, Places, Notes, and Search. Settings makes none. Profile and space shell data are separately cached.
- Local mocked Chromium metrics: LCP 252 ms, CLS 0.00073, INP 24 ms, interaction feedback 48 ms, and visible Today data 351 ms. These are diagnostics against the production artifact, not production Core Web Vitals.
- Initial preloaded JavaScript is approximately 150 kB gzip. Ordinary lazy route chunks are below 3 kB gzip. MapLibre remains an isolated lazy chunk at approximately 273 kB gzip.

## Checks still requiring the release environment

- Firefox 153 installed successfully, but a launched page never became responsive in this Windows environment; Playwright did not reach a timeout or produce a trace. Firefox is therefore blocked, not passed.
- No Supabase project credentials were available. Live sign-up, password and magic-link authentication, session restoration and refresh, protected-route restoration, logout, invite preview/accept/reject, two-account isolation/free-busy, preferences, and real data mutations remain release checks.
- The local PostgreSQL 18 server requires an unavailable password. Its installation also lacks PostGIS, pgvector, and pgTAP, and Docker is unavailable. Migrations and pgTAP were therefore not executed here.
- Run `pnpm db:reset` and `pnpm db:test` against PostgreSQL 16 with PostGIS, pgvector, pgTAP, and admin access. Then run the complete Playwright matrix against the configured Supabase project.
- Cold and warm Core Web Vitals, bundle transfer behaviour, and request timings must be measured on the deployed production build with the real Supabase project; local mocked timings are not substitutes.
