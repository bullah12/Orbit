# Orbit — clean browser rebuild prompt

Use this prompt in a fresh implementation session on the `orbit_v2` branch.

---

You are rebuilding Orbit from scratch as a fast, polished, browser-first life
organiser. The repository contains the old application only as a product and
data reference. Do not preserve its runtime architecture and do not port files
wholesale.

Read these files before editing:

1. `docs/rebuild-audit.md` — current bottlenecks and the target architecture
2. `docs/adr/0001-architecture.md` — database/RLS intent, not a mandate to keep
   direct Postgres access
3. `supabase/migrations/*.sql` — the production data contract
4. the old route/component code only when a field, behavior, or edge case needs
   clarification

## Outcome

Replace the current Next.js application with a static Vite + React + TypeScript
single-page application that:

- loads a persistent browser shell from a CDN;
- uses client-side routing with no document reload between screens;
- talks directly to Supabase through `@supabase/supabase-js` using the
  publishable key and the signed-in user's JWT;
- relies on the existing RLS policies for all data access;
- caches server state with TanStack Query;
- uses optimistic mutations and precise query invalidation;
- is visually redesigned for a desktop browser while remaining excellent at
  390 px;
- contains no LLM/AI feature in the first release;
- keeps all existing production tables and data.

The result must feel immediate on repeat use. A click must never leave the old
screen frozen with no acknowledgement while a server rebuilds a page.

## Start fresh safely

- Preserve `.git`, `supabase/`, the migration tests, seed data, `docs/`, and the
  source icon artwork until replacements are verified.
- Use git history as the backup. Remove the old Next `src/`, Next config,
  middleware, Docker-specific runtime, and obsolete tests only after the new
  scaffold builds.
- Do not create a `legacy/` copy inside the new production bundle.
- Reuse a pure old module only after isolating it, removing server imports, and
  adding focused tests. Recurrence, formatting, deterministic capture, and
  search helpers are candidates. UI and data-access modules are not.
- Keep changes on the current branch. Do not rewrite migration history.

## Required stack

- Vite
- React with strict TypeScript
- React Router
- `@supabase/supabase-js`
- TanStack Query
- Vitest
- Playwright with Chromium, Firefox, and WebKit projects
- CSS Modules plus one small global token/reset stylesheet
- one icon system only: prefer Lucide, or keep a single typed SVG component
- MapLibre only as a lazy-loaded People/Places map chunk

Do not add Next.js, an API server, server components, server actions, middleware,
an ORM, Redux, Zustand, a component framework, an animation package, or a date
library. Use native `Intl` and the existing tested date helpers where suitable.
If a new dependency is proposed, explain what code or risk it replaces.

## Application architecture

Use this simple ownership model:

- URL: active route, date/range, filters, selected list, search query
- Supabase Auth: session and user
- TanStack Query: all remote/database state
- component state: open/closed UI and unsaved form input
- local storage: device-local density/theme defaults only when not stored in
  the profile

Create one Supabase client in `src/lib/supabase.ts`:

- read `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`;
- default database schema to `orbit`, or call `supabase.schema('orbit')`;
- keep the browser client's standard session persistence and automatic refresh;
- subscribe once to auth state changes;
- never put a service-role key in a `VITE_*` variable;
- never write a custom refresh-token implementation.

Keep data access thin and domain-based in `src/data/`. UI components must not
construct ad hoc Supabase queries. Each main route owns a query key and query
function. Mutations update relevant cached objects immediately, rollback on
failure, then invalidate only the affected keys.

Do not add Realtime initially. First make the cached request/response experience
fast and correct. Realtime can later invalidate the same query keys without
changing components.

## Supabase contract and migrations

The current database uses the custom `orbit` schema. Before running the browser
app, document the required project setting:

- Supabase Dashboard → Data API → Exposed schemas → include only `orbit`.
  Keep the implementation-only `app` schema unexposed.

The existing migrations already grant schema usage and authenticated CRUD while
RLS limits rows. Verify this with a real signed-in user and the existing RLS
tests. Do not disable RLS or add broad anonymous access.

The visual rebuild does not need existing tables to change, but the browser
client needs a small additive API migration for existing operations that cannot
be expressed as safe direct table writes. Add migrations only for these concrete
requirements:

1. `0018_browser_api.sql`:
   - add the reviewed browser wrappers to the existing `orbit` schema;
   - add least-privilege, Data-API-friendly wrappers for
     `ensure_account`/`ensure_default_spaces`, `create_space`, invite
     preview/accept/decline, space-move preview, and free/busy one-off/recurring
     reads;
   - use primitive/JSON arguments and return types so the `app` schema does not
     need to be exposed;
   - use `SECURITY INVOKER` wrappers and call the already-audited underlying
     functions where an operation intentionally uses `SECURITY DEFINER`;
   - set an explicit safe `search_path`;
   - revoke default `PUBLIC` execute on every wrapper and grant execute only to
     `authenticated`;
   - add RLS/integration tests proving another account cannot widen what each
     wrapper returns or changes.
2. `0019_browser_preferences.sql`, only if theme/default compose space must sync
   between devices:
   - add `profiles.theme` with `system | light | dark` validation;
   - add nullable `profiles.default_space_id` referencing `orbit.spaces(id)`
     with `ON DELETE SET NULL`;
   - preserve existing `locale` and `week_starts_on`.
3. A later additive `orbit` dashboard RPC, only after the direct browser
   client works and measurements show multiple requests are still material.
   Make it `SECURITY INVOKER`, keep only `orbit` exposed, and grant only
   the minimum execute permissions.
4. A new index only when production-shaped `EXPLAIN (ANALYZE, BUFFERS)` output
   proves it is needed.

Do not drop, rename, or relocate any existing table. Leave AI, rules, sync, and
travel data untouched even though the first UI does not expose it. Do not move
Orbit tables into `public`.

Generate TypeScript database types from the live schema when credentials are
available. Until then, keep handwritten row types next to each domain query and
make them structurally match the migrations.

## First-release product scope

Build these capabilities end to end:

1. Authentication
   - email/password sign-in and sign-up
   - magic-link sign-in and callback
   - sign-out
   - route guard that restores the intended URL after authentication
   - clear expired/invalid-session state
2. Spaces and sharing
   - list spaces and roles
   - create and rename a space
   - members and invitation links
   - preserve `free_busy` privacy behavior
3. Today
   - range: today, 7 days, 30 days
   - events, due tasks, overdue tasks, and important people dates
   - compact counts derived from the exact records displayed
   - quick add
4. Tasks
   - smart lists: Mine, Today, Upcoming, Inbox, Waiting, Someday, Done, All
   - create, edit, complete, assign, prioritise, defer, and set due dates
   - checklist items and recurrence
   - filters by space and assignee
5. Calendar
   - day, week, and month
   - one-off and recurring events
   - free/busy-only items stay anonymous
   - create and edit the recurrence subset already supported by the old app
6. People and places
   - list, search, detail, contacts, dates, home place, and linked records
   - map as a secondary tab that is not loaded until opened
7. Notes
   - list/detail split view on desktop
   - create, edit, archive, and link to other entities
   - safe markdown rendering with raw HTML disabled
8. Search
   - keyboard-opened command palette
   - tasks, notes, people, events, and places
   - space, icon, and entity type always visible
9. Settings
   - system/light/dark
   - week start
   - default compose space
   - account and sign-out

If deterministic local capture can be isolated cheaply from `src/lib/capture`,
add it after the explicit forms work. It must remain local and make no network
or LLM call.

## Explicitly out of scope

- all AI/LLM UI, providers, prompts, consent settings, and review buttons
- rules/automation, scheduler, and push notifications
- external Google/ICS sync
- geocoding and travel-time providers
- travel mode
- custom service worker, offline write queue, devices, and conflict UI
- client-side encryption creation/editing
- realtime subscriptions

Render existing locked records honestly as unavailable/locked. Do not claim
that encryption works and do not expose ciphertext.

## Information architecture

### Desktop, 1024 px and above

Use a full-height application shell:

- collapsible 240 px left sidebar;
- brand and primary create button at the top;
- Today, Tasks, Calendar, People, Notes, and Places as primary destinations;
- spaces below a divider;
- Settings/account at the bottom;
- compact top bar in the content area with global search, current context, and
  a user menu;
- main content uses up to 1280 px and is centred within the remaining viewport.

Do not put 20 equal-weight links in the sidebar. Administrative/deferred
features do not get navigation entries.

### Mobile, below 768 px

- bottom tabs: Today, Tasks, Calendar, More;
- a floating create button above the tab bar;
- People, Notes, Places, Search, and Settings under More;
- safe-area-aware padding;
- list and detail become separate routes;
- no desktop sidebar or squeezed calendar grid.

### Tablet

- compact icon sidebar or top navigation;
- calendar becomes a three-day view where a seven-day grid would make labels
  unreadable;
- no horizontal page scrolling.

## Visual direction

Design a calm, premium household control centre—not a developer dashboard, a
marketing page, or a mobile list stretched across a monitor.

Use:

- a warm off-white canvas in light mode and deep charcoal in dark mode;
- white/near-charcoal raised surfaces;
- ink-like primary text and neutral grey secondary text;
- Orbit orange as the single interaction accent;
- space/category colours only for chips, avatars, slim left edges, and calendar
  blocks, always paired with text or an icon;
- 14–16 px body text, 28–32 px page titles, strong numeric hierarchy, and
  tabular figures for time/counts;
- 10–14 px surface radii;
- quiet 1 px borders;
- soft shadow only on menus, dialogs, command palette, and floating create;
- comfortable density: compact enough for planning, never 11 px body copy;
- Lucide-style line icons with consistent stroke and size;
- obvious keyboard focus and selected state without relying on hue alone.

Avoid:

- gradients, glassmorphism, neon glow, excessive shadows, pill-shaped
  everything, huge empty cards, oversized marketing typography, emoji icons,
  and colour-only state;
- a narrow 46 rem desktop column for the whole product;
- tiny uppercase labels as the primary hierarchy;
- hover-only actions;
- animations that delay input. Use 120–180 ms opacity/transform transitions
  only where they clarify continuity.

Create a token file before screens. Use semantic names such as `--canvas`,
`--surface`, `--surface-subtle`, `--text`, `--text-muted`, `--border`,
`--accent`, `--accent-soft`, `--danger`, `--focus`, and spacing/radius/type
scales. Provide explicit light and dark token blocks. Check every foreground/
background pair against WCAG AA before freezing the palette.

Do not depend solely on CSS `light-dark()`. The browser floor includes Safari
16.4. If using `color-mix()`, put a normal colour declaration immediately
before it as a fallback.

## Screen specifications

### Sign in

Use a two-panel desktop composition: restrained brand/value copy on the left,
focused auth form on the right. Collapse to one form column on mobile. Keep the
form direct; do not fill the page with promotional copy. Inputs and buttons are
at least 44 px high, validation is inline, and submitting visibly changes the
button state.

### Today

The desktop page uses the wide viewport:

- header: “Today”, full date, range control, search/create actions;
- compact summary row: events, due, overdue, assigned to me;
- left two-thirds: chronological agenda with current-time line;
- right one-third: due and overdue tasks with optimistic checkboxes;
- lower section: upcoming important dates and a quiet empty state;
- quick capture is one line and never pushes the agenda below the first screen.

On mobile, order: header, summary, next event, tasks, rest of agenda, upcoming.
The title of a task/event never disappears to make metadata fit.

### Tasks

Desktop uses a two-pane workspace: filterable list left, selected task detail
right. The list remains visible while editing. Include fast smart-list tabs,
space and assignee filters, keyboard navigation, and optimistic completion.
Mobile uses list and detail routes. Preserve scroll position when returning.

### Calendar

Desktop week view uses the available width with sticky day headers, an all-day
row, sensible working-hour initial scroll, a clear current-time line, and event
titles before metadata. Day and month are real alternate views. Tablet shows
three days; phone defaults to one day plus agenda. Category colour is a small
edge/fill cue, not a full saturated card.

### People and Places

Default to a fast searchable list/grid. Details show contacts, important dates,
home place, and linked items. Map is a user-selected tab and dynamically imports
MapLibre. Never request location merely because Today loaded.

### Notes

Desktop uses a note list plus editor/preview. Mobile uses separate routes. Use
debounced explicit save state (“Saving…”, “Saved”, error); do not silently lose
content. Render markdown safely with raw HTML off.

### Search / command palette

Open with `/` and `Ctrl/Cmd+K`, except while typing. Show grouped result types,
space context, keyboard selection, and recent destinations. The palette code
may be in the initial shell; full result queries begin only after a meaningful
query.

### Loading, empty, and error states

- render the shell immediately;
- keep previous route/query data visible while refreshing;
- delay skeletons briefly so warm cache hits do not flash;
- each empty state says what the user can do next;
- errors are local to the affected region and offer retry;
- auth expiry returns to sign-in with the intended route preserved;
- mutations show immediate state, rollback cleanly, and announce failure.

## Responsiveness and performance rules

- lazy-load every route except the initial shell and default Today route;
- preload a route on sidebar hover/focus and mobile touchstart when reasonable;
- MapLibre, calendar editing, note editor, and large dialogs must be separate
  chunks;
- do not fetch hidden tabs;
- cache spaces and stable reference data for minutes, not milliseconds;
- use one Data API request per main route where practical, two maximum;
- never refetch every smart list after a one-row task mutation;
- avoid virtualization until a measured list exceeds 200 rendered rows;
- do not memoize every component pre-emptively; measure first;
- use native image lazy loading and explicit dimensions;
- no render-blocking webfont; prefer the system font stack;
- do not register a service worker in the first release.

Budgets:

- initial JavaScript < 180 kB gzip;
- ordinary route chunk < 80 kB gzip;
- warm navigation produces visible feedback < 100 ms;
- LCP < 1.8 s, INP < 150 ms, CLS < 0.05 on a mid-tier mobile profile;
- zero horizontal page scrolling at 390, 768, 1024, and 1440 px.

Report actual bundle and browser measurements; do not claim the budgets from
source inspection alone.

## Accessibility and browser support

- semantic landmarks, headings, labels, buttons, links, and dialogs;
- `aria-current` for navigation and selected range/view;
- visible `:focus-visible` treatment on every interactive control;
- 44 px minimum touch target on coarse pointers;
- colour never the sole state cue;
- keyboard operation for navigation, tasks, calendar controls, dialogs, and
  command palette;
- focus trapping and restoration for modal dialogs;
- `prefers-reduced-motion` support;
- native date/time controls where they improve mobile usability;
- UK defaults (`en-GB`, Monday first, Europe/London) without preventing another
  stored user locale/timezone later;
- support Chrome/Edge 111+, Firefox 114+, Safari 16.4+, current iOS Safari and
  Android Chrome;
- use `100vh` before `100dvh` and test safe areas.

## Implementation order

Work in vertical slices. Do not scaffold every feature before one works.

### Slice 0 — baseline and data proof

- capture the current branch status;
- confirm migration order and current RLS tests;
- document Supabase exposed-schema setup;
- prove a signed-in browser can select its profile and spaces through
  `supabase-js` without a service role;
- record request counts and timings.

### Slice 1 — new shell

- create the Vite app, tokens, routing, auth provider, query client, error
  boundary, responsive shell, and sign-in flow;
- implement theme without first-paint flash;
- build at 390, 768, and 1440 px;
- delete no legacy source yet.

### Slice 2 — Today

- implement spaces and the Today query/payload;
- build real agenda and task rows;
- add optimistic task completion;
- measure request count, route response, bundle, and Core Web Vitals;
- only now remove the obsolete Next shell and its runtime dependencies.

### Slice 3 — Tasks and Calendar

- complete task list/detail and recurrence;
- build calendar views and event editing;
- preserve free/busy anonymity;
- add route-level browser tests.

### Slice 4 — People, Places, Notes, Search, Settings

- add each as a complete route with loading/error/empty states;
- keep map/editor code split;
- add profile preferences migration only if cross-device storage is required.

### Slice 5 — hardening

- RLS isolation tests;
- auth refresh observed across token expiry;
- magic link observed end to end;
- browser matrix and responsive visual pass;
- accessibility audit;
- production build/bundle report;
- cold and warm performance measurements against the real Supabase project.

## Definition of done

- production build succeeds with no Next server;
- static deployment serves deep links with SPA fallback;
- sign-up, sign-in, refresh, magic link, sign-out, and protected routes work
  against real Supabase;
- RLS proves one account cannot read or mutate another account's inaccessible
  spaces;
- Today, Tasks, Calendar, People, Places, Notes, Search, and Settings work with
  real data;
- core mutations are optimistic and have tested rollback states;
- no LLM request, key, copy, route, or control exists;
- no service-role key is present in the browser output;
- existing tables/data are preserved;
- no page has horizontal scrolling at the required widths;
- Playwright passes in Chromium, Firefox, and WebKit;
- keyboard and screen-reader semantics are verified;
- performance and bundle budgets are measured and reported;
- README contains local setup, Supabase exposed-schema setup, environment
  variables, migration steps, tests, and deployment instructions.

At handoff, provide:

1. a concise architecture summary;
2. files removed and files retained;
3. migrations added and why;
4. real request-count, bundle, and browser performance measurements;
5. browser/accessibility test results;
6. deliberately deferred capabilities;
7. any manual Supabase dashboard step still required.

Do not call the rebuild complete because it looks correct in one Chromium
viewport. It is complete when the real Supabase auth/session path, RLS, the
responsive browser UI, and the measured performance all work together.
