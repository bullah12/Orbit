# Handoff: Orbit visual system — second pass + three-surface IA

## Overview

Orbit is a shipped household organiser (shared calendar, tasks, spaces, location
sharing). Two things are handed off, and they are separable:

1. **A revision of `src/app/globals.css`** — same file, same token names, tighter
   numbers, plus tokens and utilities for surfaces the old stylesheet never
   covered (agenda blocks, a range switch, a map). Drop-in; no markup has to
   change for the colour, focus, radius, elevation and print work to land.
2. **An IA change** — from a calendar-first single surface to **three pages:
   Now, Calendar, People**, with the Today/Week/Month range switch owned by
   *Now*, not the calendar. This is real rework; see "Rework required".

## About the design files

`Orbit Visual System.dc.html` is a **design reference created in HTML** — a
specimen sheet, not production code. It renders light and dark specimens of
every affected component, mockups of the three pages, the stylesheet as text,
computed contrast tables for both themes, the change list, and verification
notes. Open it in a browser.

**Do not port its markup.** It is inline-styled on purpose so it renders
standalone, duplicating literal colour values that the real app must read from
custom properties. **The only file to copy verbatim is `globals.css`** — it is
the actual artifact being revised. Everything else is documentation: recreate
the screens in Orbit's existing Next.js + Tailwind v4 + React codebase using its
established components. `support.js` is only the runtime that lets the `.dc.html`
open in a browser; it has nothing to do with the app.

## Fidelity

**High fidelity.** Final colours, typography, spacing, radii and states. Every
colour is an exact oklch value in `globals.css`, and every contrast ratio quoted
was computed from those values (oklch → linear sRGB → WCAG relative luminance),
not eyeballed — see `contrast.json` and `contrast-map.json`. The page mockups are
hifi for styling and hierarchy, schematic for data: real content is longer and
must be allowed to wrap or truncate.

---

## Rework required

### 1. `/` becomes Now; the range switch moves off the calendar

The instinct is to put Today/Week/Month on the calendar, because that is where
those words live in other products. But the calendar is a **placement** tool —
you open it already knowing the date. Now is the page that answers a
**question**, and Today/Week/Month is that question at three grains: what do I
need to do today, this week, this month. Same query, same layout, one parameter.
Keeping the switch on the calendar splits one idea across two pages.

- `/` renders Now (was: calendar)
- `/calendar` renders the grid
- `/people` renders the map
- Range lives in the URL: `/?range=today|week|month`, default `today`. It must
  survive reload and be linkable.

### 2. One query per page, not one per widget

Now issues a **single** request — `summary(range)` returning counts, events and
due items together. That is what makes the summary strip trustworthy: the number
and the list beneath it cannot disagree, because they came from one payload.

```ts
type Summary = {
  range: 'today' | 'week' | 'month';
  counts: { events: number; tasks: number; overdue: number };
  perPerson: { personId: string; name: string; colour: CategoryColour; count: number }[];
  events: { id: string; startsAt: string; endsAt: string | null; title: string;
            categoryColour: CategoryColour; spaceName: string | null;
            note: string | null; anonymous: boolean }[];
  due:    { id: string; title: string; done: boolean; state: 'due' | 'overdue';
            categoryColour: CategoryColour; categoryName: string;
            locked: boolean; pending: boolean }[];
};
```

### 3. People is a page, not a widget on Now

Location is glanceable but rarely actionable, and a live map on the landing page
means the first thing the app does every morning is ask for GPS. One nav step
away.

### 4. Nav drops to three items

Now · Calendar · People, plus settings. Three is small enough that a top row
works and the dense sidebar can go, returning its width to content.

---

## Screens / views

### Now (`/`) — the tool page

**Purpose.** Answer "what do I need to do" for the selected range. The landing
page, opened ten times a day.

**Layout.** Single column, `max-width: 46rem`, centred. Four regions in one
`.surface`, separated by `1px solid var(--line)`:

| Region | Content | Notes |
|---|---|---|
| Header | weekday `text-xl/600` `-0.01em`, date `text-xs` muted tabular, spacer, `.seg` right | `padding: .5rem .625rem`; **must wrap**: `flex-wrap: wrap; gap: .375rem .5rem`, switch is `flex: none; white-space: nowrap` |
| Summary strip | three `.stat`s + a right-aligned aside | `padding: .625rem`, `background: var(--bg)`, `gap: .5rem 1.375rem`, wraps |
| Agenda | 44px time gutter + `.block` per event, `.now-line` in position | `gap: .375rem`, `padding: .625rem` |
| Due list | `.section-label` heading, then `.row`s | `.row + .row` supplies the divider |

**Range switch (`.seg`).** Selection is carried by three non-hue signals —
raised surface, `--line-strong` border, weight 600 — because it sits directly
above ten coloured chips and must not compete with them. Render as
`role="group"` of buttons with `aria-current="true"` on the selected one;
`aria-current` is the styling hook. Intrinsic width ≈ 162px — never let the
container squeeze below it (it clipped "Month" to "Mont" in review).

**Summary (`.stat` / `.stat-num`).** Number `text-xl/600` tabular, label
`text-2xs` uppercase `.06em` muted. Overdue renders number *and* label in
`--danger` — the only coloured stat. No card: a stat that needs a box around it
is a stat nobody trusted.

**Agenda block (`.block`).** `padding: .5rem .625rem`, `--bg-raised`, hairline,
**`border-left: 3px solid`** in the category colour, `--radius-md`. Title
`text-base`, meta `text-xs` muted. Colour on the left edge *only* — filling the
block turns a stack into a colour chart. The block containing now gets
`.block-now` (left edge → `--accent`). Times sit in a fixed 44px gutter,
`text-2xs/500` tabular muted, `padding-top: .5625rem` to align to the title.

**Now-line (`.now-line`).** One `1px` `--accent` rule, 6px dot at the gutter
edge, `now HH:MM` label. One per view, and the only bare accent hairline in the
app: not interactive, means exactly one thing.

Mock copy (schematic): `Thursday` · `30 July` · `3 events` `5 tasks` `1 overdue`
· `Priya has 2` · `09:30 Standup / 30 min · Travel` · `now 11:04` ·
`13:00 Plumber — front door / 1 hr · Home` · `16:40 Danny — swimming pickup /
Danny · Priya driving` · `Due today` · `Book dentist / overdue` · `Bins out / Home`.

### Calendar (`/calendar`) — the grid

**Purpose.** Place things. You arrive knowing the date.

Header: `Week 31` `text-lg/600`, range `text-xs` muted tabular, spacer, `Today`
button (13px, hairline, `--radius-md`). Body:
`grid-template-columns: var(--gutter) repeat(7, minmax(0, 1fr))` — the mock
shows 4 columns for space only; ship 7.

- Hour gutter: `text-2xs` tabular `--text-faint`, right-aligned.
- Day heads: `text-2xs/500` muted; **today is 600 at full `--text`**.
- Day dividers `1px solid var(--line)`; hour rules inside a column
  `1px solid var(--bg-sunken)` — deliberately lighter, so vertical structure
  dominates horizontal.
- Slots: `min-height: var(--row-min)` (30px), `padding: 2px`.
- Events: `text-2xs`, `padding: 2px 4px`, `--radius-md`, `--c-*-bg` fill,
  `--c-*` text, `border-left: 2px solid var(--c-*)`. The dense chip form — same
  tokens as `.block`, smaller geometry.
- Anonymous external-calendar blocks use **`.busy`**: sunken, dashed
  `--line-strong`, italic, muted, **no hue**. Someone else's time must read
  quieter than every real event without spending one of the ten colours on it.
- The now-line appears once, absolutely positioned in today's column.

### People (`/people`) — where everyone is

**Purpose.** Glance at who is where. Read-only.

One `.surface`: a `.map` region (mock 190px; ship `min-height: 18rem`, flexible)
above `.row`s.

- Map surfaces are **chrome, not category colour**: `--map-water` behind,
  `--map-land` shapes, `--map-line` strokes — greyscale plus the least blue that
  still says "sea", because ten coloured pins sit on top.
- **Pins (`.pin`)**: `--bg-raised` pill, hairline, `border-radius: 999px`,
  `text-2xs/500`, nowrap, a 7px round colour dot **and the person's name**.
  Colour is reinforcement, never the only cue. The
  `box-shadow: 0 0 0 2px var(--map-land)` halo is load-bearing — it keeps a pin
  readable when it straddles a coastline. Do not drop it.
- List rows: dot, name, place `text-xs` muted, last-seen `text-xs` tabular
  `--text-faint`.
- Sharing off gets **`.locked`** (mono, muted, dashed) rather than vanishing.
  The absence has to read as deliberate.
- The mock's map area is a striped CSS placeholder with a mono caption
  (`map tiles — real geo data`). Ship real tiles; the placeholder exists so the
  specimen does not fake cartography.

---

## Interactions & behaviour

- **Range switch** sets `?range=`, refetches `summary(range)`, does not change
  layout shape: week groups the agenda per day, month per week.
- **Navigation**: Now → Calendar preserves the focused date; Calendar → Now
  resets to `today`.
- **Task checkbox** is optimistic — row text takes **`.pending`** (muted, dotted
  underline) until the write is acknowledged. Dotted underline survives
  greyscale and, unlike an icon, does not change row height or width.
- **Conflict resolution**: "Keep mine" / "Keep theirs" have equal visual weight.
  Neither is a default; do not make one primary.
- **Hover**: `.row-hover:hover` → `--bg-hover`. Blocks and pins do not change
  colour on hover. No hover-only information anywhere — touch exists.
- **Focus**: global `:focus-visible` — 2px `--focus-ring` outline, 2px offset,
  plus a 2px `--focus-halo` box-shadow *underneath*. The ring's contrast is
  measured against the halo, not the substrate; that is what makes it safe on a
  violet chip or an emerald event block.
- **Motion**: almost none, and `prefers-reduced-motion` neutralises what exists.
- **Loading**: no spinners on Now. One query — render the shell, let the four
  regions arrive together.
- **Responsive**: the three-column specimen grid is a documentation artefact; in
  the app each page is a single column. Below ~40rem the calendar drops to a
  3-day window; Now is unchanged.
- **Print**: handled in `globals.css` — a household prints a packing list.

## State

| State | Owner | Notes |
|---|---|---|
| `range` | URL (`?range=`) | `today` default; drives the one query |
| `summary` | server cache keyed by `range` | one fetch per page view |
| `focusedDate` | URL on `/calendar` | preserved when navigating from Now |
| `optimisticTasks` | local, per task id | drives `.pending` |
| theme | OS `prefers-color-scheme` | **no manual toggle** — see assumptions |

## Design tokens

Read tokens from `globals.css`; do not copy values into components.

**Type scale** (`@theme`, six steps, line-height travels with size):
`--text-2xs` 11px/1.36 · `--text-xs` 12px/1.4 · `--text-sm` 13px/1.4 ·
`--text-base` 14px/1.45 · `--text-lg` 15px/1.4 · `--text-xl` 17px/1.28.
Replaces nine hard-coded sizes: 10px folds into 11px, 12.5/13.5px into 12/13px.

**Radius**: `--radius-sm` 3px (inside a row) · `--radius-md`/`--radius-DEFAULT`
4px · `--radius-lg`/`--radius` 8px (a surface). DEFAULT is pinned so the ~169
existing bare `rounded` utilities land on the scale.

**Rhythm**: `--row-min` 30px · `--row-pad-y` 5px · `--row-pad-x` 8px ·
`--row-gap` 8px · `--gutter` 52px (agenda times, week columns and the day grid
hang off this one left edge, so 24-hour times read down a straight line).

**Chrome** (light → dark, hue 265 throughout): `--bg` 98.6% → 16.5% ·
`--bg-raised` 100% → 21% · `--bg-sunken` 96.2% → 13% · `--bg-hover` 94.6% → 26% ·
`--text` 22% → 95% · `--text-muted` 47.5% → 74% · `--text-faint` 60% → 60% ·
`--line` 89% → 30% · `--line-strong` 80% → 40%. A trace of blue keeps white
surfaces from going yellow next to the chips. Dark is not an inversion: rows
separate by a wider luminance step because a hairline carries less on dark.

**Accent & status**: `--accent` `48% .14 258` → `76% .12 258`; `--danger`,
plus **new** `--warning` and `--success` (+ `-bg`s) — alerts were borrowing
category amber and rose, making one colour mean both "Work" and "careful".

**New**: `--focus-ring`, `--focus-halo`, `--map-water`, `--map-land`,
`--map-line`.

**Ten category hues** (names fixed — they are database values in
`spaces.colour` / `categories.colour`): rose, orange, amber, lime, emerald, sky,
indigo, violet, fuchsia, slate, each with a `-bg`. Respaced 27–40° apart
(violet/indigo were 20°) with varied lightness (46.5–52.5% light), so pairs that
collapse under deuteranopia — emerald/lime, rose/orange, indigo/violet — still
separate when hue stops helping.

**Utilities**: existing names unchanged (`.surface` `.hairline` `.muted`
`.faint` `.row-hover`); `.row` `.section-label` `.tabular` `.chip` `.chip-plain`
`.busy` `.locked` `.pending` `.input` `.skip-link`; new for these screens
`.seg` `.block` `.block-time` `.block-now` `.now-line` `.stat` `.stat-num`
`.map` `.map-land` `.pin`.

**Elevation: none, deliberately.** Surface, sunken and a hairline are the whole
vocabulary — a shadow on a flat row is a soft edge repeated a thousand times,
which is how a dense app starts to look tired. `box-shadow` appears on exactly
two things, neither decorative: the focus halo and the pin halo, both hard-edged
rings separating an element from a substrate the palette cannot predict.

**Priority and status stay text-only.** They are ordinal, not categorical.
Colouring them would compete with the one thing colour already means (which
person, which space).

## Contrast

`contrast.json` and `contrast-map.json` hold every computed ratio, both themes.
Nothing fails.

- `--text` on every surface: 13.4–17.4 both themes.
- `--text-muted` ≥ 6.4 everywhere; `--text-faint` ≥ 3.5 (secondary use only).
- Category foreground on its own fill: 4.69–6.12 light, 5.70–8.03 dark. The old
  palette's only real failures were warm fills — orange 4.30, amber 4.42, lime
  4.11 — now 4.97 / 5.09 / 4.92.
- Worst pin on `--map-land`: sky 4.55 light, indigo 6.62 dark. On `--map-water`:
  5.02 / 8.51.
- `--accent` on `--bg`: 5.33 → 6.37. 5.33 was too near the 4.5 floor to survive
  a nudge.

### Contrast test — read before touching the print block

`tests/contrast.test.ts` parses `globals.css` **as text** and treats any value
outside the dark-scheme block as a light-theme value. The print block therefore
uses CSS colour *keywords* on classes (`white`, `black`, `dimgray`, `gray`) and
**no `oklch()`, no token overrides** — a token-based print palette would silently
become the palette under test. Keep it that way.

## Assets

None. No images, icons or webfonts. Type stack is `ui-sans-serif, system-ui,
-apple-system, 'Segoe UI', Roboto, sans-serif` with `ui-monospace, 'SF Mono',
Menlo, monospace` for locked/placeholder states. The specimen's map placeholder
is a CSS gradient, not an asset.

## Files in this bundle

| File | What it is |
|---|---|
| `globals.css` | **The deliverable.** Drop-in replacement for `src/app/globals.css`. |
| `Orbit Visual System.dc.html` | Design reference: specimens, three-page mockups, contrast tables, change list. Open in a browser; do not port its markup. |
| `support.js` | Runtime needed only to open the file above. Not part of the app. |
| `contrast.json` | Computed ratios — core and category tokens, both themes. |
| `contrast-map.json` | Computed ratios — map surfaces and pins. |
| `CLAUDE_CODE_PROMPT.md` | Paste-ready prompt for implementing this in the Orbit repo. |

## Verification

1. `pnpm test` — `tests/contrast.test.ts` green, **no skipped tokens**. Confirm
   the parsed-token count rose by the new ones per theme (`--success`,
   `--warning` + `-bg`s, `--focus-ring`, `--focus-halo`, `--map-water`,
   `--map-land`, `--map-line`). A silently-unparsed token is the failure mode
   this test exists to catch.
2. `pnpm build` — confirms Tailwind emits `text-2xs … text-xl`. If a `text-*`
   class produces nothing, the `@theme` name is wrong.
3. `pnpm smoke` — both colour schemes, every interactive control named.
4. By eye, both schemes: tab until focus lands on a space chip and on a calendar
   event block — a neutral gap must show inside the ring. Open week view with a
   busy block visible: quieter than every real event, no hover needed. On
   People, check a pin straddling a coastline. On Now, screenshot the range
   switch and desaturate — selection must still be obvious.
5. Regression: the ~50 former `text-[10px]` sites grow 1px. Scan the sidebar
   footer and the calendar hour gutter for wrapping.
6. Layout: the range switch's intrinsic width is ~162px inside a container with
   `overflow: hidden`. Verify at 320, 375 and 1440px that "Month" is not clipped.

## Assumptions (each cheap to reverse)

- Chip fills are a hair lighter in light mode to buy warm-hue headroom.
- `--success` / `--warning` are additive and touch nothing existing.
- **No manual theme toggle.** Adding one means a `data-theme` attribute on
  `<html>`, duplicating the dark block under that selector, and teaching the
  test's brace-matcher about it — worth doing only alongside a settings surface.
- The mock shows a 4-column calendar for space; the real grid is 7.
- Sample data (Priya, Danny, Sam) is illustrative, not product copy.
