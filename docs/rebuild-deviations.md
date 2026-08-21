# Rebuild verification notes

Date: 2026-08-19

## Decisions and deviations

- The direct Today implementation measured three domain requests. Migration `0020_browser_dashboard.sql` was therefore added under the rebuild brief’s measured-performance exception, reducing Today to one route payload while retaining security-invoker RLS behavior.
- Free/busy calendar spaces use the two narrow wrappers from `0018`; a user with multiple availability-only spaces can exceed the ordinary two-request route target. This is retained for privacy correctness rather than adding a broader API surface without production measurements.
- Deterministic quick capture was not ported. Explicit create forms are complete and the old capture layer was coupled to obsolete server paths.
- Existing locked records are shown as unavailable. This release does not create or edit ciphertext.

## Local verification environment

- No `.env.local` or live Supabase credentials were available.
- No local PostgreSQL server was running and the Docker daemon was unavailable, so pgTAP migrations were not executed here.
- npm registry access was blocked. Official Supabase, TanStack Query, Lucide, React and Vite packages were taken from local caches for compilation. React Router was unavailable in cache, so local browser verification used an uncommitted compatibility harness while `package.json` targets official `react-router-dom`; a clean `pnpm install` and repeat build remain required.
- Installed Google Chrome was used for the Chromium Playwright project. Firefox and WebKit browser binaries were absent and could not be downloaded.

## Measurements

- strict TypeScript: pass
- Vitest: 7/7 pass
- Chromium Playwright: 4/4 pass using installed Chrome — responsive sign-in at 390/768/1024/1440, mocked signed-in Today, command palette, and request/timing instrumentation
- Firefox/WebKit Playwright: not run; missing binaries
- production build: pass with the locally cached dependency set
- initial JavaScript: approximately 139 kB gzip including the initial route/auth helpers
- largest ordinary route chunk: approximately 2.2 kB gzip
- MapLibre: isolated lazy chunk, approximately 273 kB gzip
- Today: one domain RPC after `0020`; the measured initial load made three Data API calls total (`profiles`, `dashboard`, `spaces`) because profile/spaces are separately cached shell data
- mocked cold navigation to visible Today data: 473 ms locally (not a production Core Web Vital)

Cold/warm Core Web Vitals against the real Supabase project remain a live release check; local mocked timings are not presented as production LCP/INP.
