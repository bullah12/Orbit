# Prompt for a design session

Copy everything below the line into Claude. It is written to *extend and apply*
Orbit's existing design system rather than replace it — the system is real,
tested, and its colour names are database values that cannot change.

---

## Brief: artwork, and the design of each page

You are designing for **Orbit**, a household organiser for two people sharing a
home — tasks, notes, people, a calendar, places, travel, rules and search, all
scoped into "spaces" (Priya, Home, Work). It is a web app, used mostly on a
phone while somebody is standing in a kitchen, and on a desktop in the evening.

**There is already a design system, it is deliberate, and it is enforced by
tests.** Your job is not to invent a new one. Read the constraints below as
hard boundaries, then do the three pieces of work at the end.

### The standing rules (settled by the product owner — do not revisit)

- **No streaks, badges, gamification, points, or guilt.** Ever. Nothing that
  congratulates or nags.
- **No "who viewed what" tracking.** Ever.
- **Category colour is the only strong colour in the app**, and it never appears
  without an icon *and* a text label beside it. Colour is always reinforcement,
  never the only signal.
- **Calm, dense, neutral chrome.** A person should be able to run their eye down
  a list and find one row without reading every word.
- **Full dark mode**, equal in quality to light — not an inversion.
- **UK conventions throughout**: DD/MM/YYYY, 24-hour clock, Monday-first weeks
  (Sunday is a user preference), Europe/London.

### The token system you must work inside

One stylesheet, `src/app/globals.css`. Every colour is declared **once**, as a
`light-dark(<light>, <dark>)` pair in `oklch()`, against
`:root { color-scheme: light dark }`. A pinned theme is `color-scheme: only
light` / `only dark` on `[data-theme]`. **There is no second copy of the palette
and there must never be one** — that was the whole point of merging them.

Chrome and status (22 pairs):

```
--bg  --bg-raised  --bg-sunken  --bg-hover
--text  --text-muted  --text-faint
--line  --line-strong
--accent  --accent-text
--danger  --danger-bg   --warning  --warning-bg   --success  --success-bg
--focus-ring  --focus-halo
--map-water  --map-land  --map-line
```

Category and space colours (10 pairs, each with a `-bg` chip fill):

```
--c-rose  --c-orange  --c-amber  --c-lime  --c-emerald
--c-sky   --c-indigo  --c-violet --c-fuchsia --c-slate
```

**These ten names are database values** (`spaces.colour`, `categories.colour`),
so the *names* are fixed. Their values may be tuned; their identities may not.
They are currently spaced 27–40° apart in hue, and the pairs that collapse under
deuteranopia — emerald/lime, rose/orange, indigo/violet — also differ in
lightness, so they stay distinguishable when hue stops helping. Preserve that
property.

Non-colour tokens you should design *with*, not around: `--radius`,
`--row-min` (1.875rem), `--row-pad-y/x`, `--row-gap`, `--gutter` (the calendar's
3.25rem time gutter), `--tabbar`, `--measure` (64rem — the readable cap for
reading surfaces; grids and calendars opt out), and a six-step type scale
`--text-2xs` (11px) through `--text-xl` (17px).

### Contrast thresholds that are measured, not eyeballed

`tests/contrast.test.ts` reads both halves of every pair out of the stylesheet
and computes real WCAG ratios **for each theme**. Any value you propose must
clear these or the build fails:

| Pair | Floor |
|---|---|
| `--text` on `--bg`, `--bg-raised`, `--bg-sunken`, `--bg-hover` | 4.5:1 |
| `--text-muted` on `--bg`, `--bg-raised` | 4.5:1 |
| `--text-faint` on `--bg`, `--bg-raised`, `--bg-sunken` | 3:1 |
| `--accent-text` on `--accent`; `--accent` on `--bg` | 4.5:1 |
| `--danger` on `--bg` and `--bg-raised` | 4.5:1 |
| `--c-X` on its own `--c-X-bg` | 4.5:1 |
| `--c-X` on `--bg` | 4.5:1 |
| `--c-X-bg` vs `--bg` (must be visible as a shape) | > 1.05 |
| `--line` vs `--bg` (visible without shouting) | 1.1–6 |

The two halves of every pair must also be **different** from each other, and no
token may be declared as a single value.

### The surfaces

- `/` **Today** — the landing page. A range switch (today/week/month), a summary
  strip of three counts, an agenda of real events against the time gutter with a
  "now" line, then what is due.
- `/tasks/[list]` — nine smart lists (Mine, Today, Overdue, Upcoming, Inbox,
  Waiting, Someday, All open, Done). Dense rows: checkbox, title, assignee,
  category chip, due date, space indicator. Two lines on a phone, one on desktop.
- `/tasks/item/[id]` — task detail, with checklist and linked notes.
- `/calendar/[view]` — day, week and month. Merged across spaces, with
  **anonymous "Busy" blocks** for spaces you only have free/busy on.
- `/calendar/event/[id]`, `/calendar/import`
- `/capture` — one text box that parses "bins out tomorrow at half seven @danny
  #home" and reads it back as chips before creating anything.
- `/notes`, `/notes/[id]` — Markdown, with versions.
- `/people`, `/people/[id]` — contacts, dates, linked records.
- `/places`, `/places/[id]` — with a small map surface (`--map-*`).
- `/travel`, `/travel/trip/[id]` — trips and derived journeys.
- `/rules`, `/rules/[id]` — an automation engine with a dry-run.
- `/search` — across five kinds.
- `/spaces`, `/spaces/[id]`, `/invite/[token]` — membership and invitations.
- `/sync` — the offline queue, named conflicts, per-device cursors.
- `/settings` — theme, week start, default space, offline, devices.
- `/ai` — off by default, per-feature and per-space consent.
- `/auth/signin`, `/auth/signup`, `/auth/callback`
- `/offline` — a standalone page shown when the network is gone. It carries **no
  user data at all**, by design.

Navigation: a 240px rail on desktop; below `md`, a bottom tab bar (Today,
Calendar, Capture, Search, People) plus a **More** drawer holding the rest.

---

## What to produce

### 1. An app icon set — this is the real gap

`src/app/manifest.ts` makes Orbit installable, and it declares **no icons**,
because there is no artwork in the repository. Installing it today puts a blank
letter tile on somebody's home screen.

Design a mark and deliver:

- The concept, and why it suits a *calm household organiser* rather than a
  productivity tool that wants to be opened.
- **SVG source**, on a square canvas, that works at 512px and is still readable
  at 48px and as a 16px favicon.
- A **maskable** variant respecting Android's safe zone (the inner 80% circle).
- Light and dark treatments, plus the flat `background_color` / `theme_color`
  to declare (currently both `#f9fafb`, matching `--bg` in light).
- The exact `icons` array to put in `manifest.ts`, with sizes, `type` and
  `purpose`.

Constraints: it must read at a glance on a cluttered home screen; it should use
the existing palette rather than a new brand colour; no gradients that die at
small sizes; no text in the mark.

### 2. Per-page design treatment

For each of the main surfaces above (Today, a task list, the calendar's three
views, Capture, People, Places, Sync, Settings, and the sign-in pages), specify:

- What the eye should land on **first**, and what carries that — weight, a
  raised surface, a stronger edge. **Not hue**, because the navigation and every
  row already sit above ten coloured chips and must not compete with them.
- The **empty state**, in a sentence that says what to do rather than "No items".
- The **phone layout at 390px**, and what wraps or drops when space runs out.
  The rule that already holds: whatever else moves, the *title* never does.
- Anything you would change in the existing structure, with the reason.

### 3. Any palette refinements

Only if you can justify them. Deliver as `light-dark(oklch(…), oklch(…))` pairs
using the existing token names, with the computed contrast ratio for each
affected pair in both themes, so they can be checked against the table above
before anything is changed.

## How to answer

Give me reasoning, not just output. For each decision, say what it costs and
what you rejected. If one of the constraints above seems wrong to you, argue it
explicitly rather than quietly working around it — several of them are load
bearing and the reasons are not always visible from outside.

Do not produce a redesign that discards the token system. The value of that
system is that a colour cannot drift out of contrast without a test going red,
and anything that breaks that property is a step backwards however it looks.
