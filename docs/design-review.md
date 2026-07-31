# Orbit — design and functionality review

Written session 10. Every claim below was checked against the running app at
`localhost:3000` (seeded, as Priya) or by counting occurrences in `src/`. Where
a number appears, the command that produced it is given.

This document is a review and a plan. `docs/STATUS.md` remains the handoff
contract; this file does not replace it.

---

## What is already good, and must survive any change

Stated first because most of the improvements below are additions, and an
addition is the easiest way to break something that was right.

- **The token system is genuinely designed, and it is tested.** `tests/contrast.test.ts`
  parses `globals.css` as text and computes WCAG ratios from the oklch values.
  A stylesheet with a contrast test in CI is rarer than it should be.
- **Colour never travels alone.** `.chip` is geometry only; `SpaceIndicator`
  supplies colour *and* icon *and* label. The ten category hues are spaced
  27–40° apart and the pairs that collapse under deuteranopia also differ in
  lightness. This is the single best decision in the codebase.
- **The focus ring is measured against its own halo**, not against whatever it
  lands on, which is what makes it safe on a violet chip.
- **There is a print stylesheet**, and it is written in colour keywords
  specifically so the contrast test does not mistake it for a theme.
- **Pure logic lives in pure modules with tests written first** — `recurrence`,
  `calendar`, `travel`, `rules`, `capture`, `conflict`, `search`.
- **Local natural-language capture.** `tests/capture.test.ts` reads its own
  source back and fails if a `fetch`, an `import()` or an AI provider ever
  appears in it. No competitor in this category parses on-device.
- **Conflicts are named, never silently resolved.** No last-write-wins.

None of the work below should cost any of these.

---

## Findings

### A. The app is unusable on a phone — not unpolished, unusable

**Severity: critical.** This is the finding that matters more than all the
others combined.

Evidence:

```
$ grep -roh "\b\(sm\|md\|lg\|xl\):[a-z0-9-]*" src --include=*.tsx | sort | uniq -c
      3 sm:grid-cols-2
      2 sm:grid-cols-3
      1 sm:grid-cols-4
      1 sm:inline
      1 lg:grid-cols-
```

Eight responsive utilities in 26,003 lines of TypeScript and TSX. Further:

- `src/app/layout.tsx` exports `metadata` but **no `viewport`**. Mobile browsers
  therefore assume a ~980px layout viewport and scale the page down.
- `src/components/Sidebar.tsx` is `w-60 shrink-0` with **no breakpoint**. That
  is 240px of a 390px phone — 62% of the screen — permanently, on every page.
- `src/components/calendar/DayColumns.tsx` uses `min-w-max` with
  `repeat(7, minmax(9rem, 1fr))`, so the week grid has a hard floor of roughly
  1008px.
- There is no web app manifest and no `theme-color`, so Orbit cannot be added to
  a home screen.

A screenshot at 390×844 shows the consequence plainly: **task titles are pushed
entirely off-screen.** A row renders its checkbox, "1/2 steps" and a truncated
category, and the title — the only part that matters — is not visible at all.
Text overlaps further down the page.

Why this outranks everything else: Orbit is a *household* organiser. Bin day,
the plumber, the swimming pickup, "did you get bin bags" — these are consulted
standing in a kitchen holding a phone, not sitting at a 1440px monitor. Every
product in this category (Cozi, Skylight, OurHome, Picniic) is phone-first.
`docs/deployment-and-android.md` plans a native Android client to serve this
need; a responsive web app serves it sooner, for a fraction of the work, and the
Android client still wants it.

### B. The design system shipped surfaces that were never built

**Severity: high.** Commit `74789ce` adopted the revised `globals.css` from
`docs/design_handoff/`. The handoff's "Rework required" section — the Now page,
the three-surface IA — was never implemented. The stylesheet is therefore
carrying utilities and tokens that no markup uses:

```
$ grep -roE "className=\"[^\"]*\b<name>\b[^\"]*\"" src --include=*.tsx | wc -l
.seg          0      range switch (Today / Week / Month)
.stat         0      summary numbers
.stat-num     0
.block-time   0      agenda block time
.block-now    0      the block containing now
.now-line     0      the current-time rule
.map          0
.map-land     0
.pin          0
```

Plus the tokens `--gutter`, `--map-water`, `--map-land` and `--map-line`.

Nine utilities and four tokens, designed, contrast-checked, documented, and dead.

### C. Today shows no events

**Severity: high**, and it is the concrete form of finding B.

`src/app/page.tsx` queries `listTasks`, `yesterdaySummary`, `upcomingDates` and
`listConsents`. It never queries events. So the page called **Today** — the
landing page, the one opened ten times a day — answers "what is due" and
"whose birthday is near" but not **"what is on today"**, which is the question
a household calendar exists to answer.

The seeded account has 14 events this week and Today shows none of them.

### D. Assignment is modelled, indexed, queried — and invisible

**Severity: high**, and it is the cheapest fix in this document.

- `supabase/migrations/0002_tasks_notes.sql:58` — `assignee_id uuid references public.profiles(id)`
- `:76` — `create index tasks_assignee_idx on public.tasks (assignee_id) where status in ('todo','doing','blocked')`
  — a partial index built precisely for "open tasks assigned to me", a query
  nothing in the app writes.
- `src/lib/queries/tasks.ts:117-120` selects `assigneeName`, `assigneeId` and
  computes `isMine` **on every row returned**.
- `src/components/TaskRow.tsx` renders none of it.
- `ComposeTask` cannot set it.
- There is no "Mine" smart list.
- The only place it surfaces is a `<select>` on `/tasks/item/[id]`.

In a two-person household, *"whose job is this?"* is the question the product
exists to settle. The row does not answer it, and the database has been ready to
since Phase 0.

### E. The calendar wastes half its viewport and hides its titles

Verified from a week-view screenshot:

1. **It opens at 01:00.** Roughly seven empty night hours occupy the top of the
   grid before the first real event. Nothing scrolls to now, or to the working
   day. Google Calendar, Fantastical and Apple Calendar all scroll to now.
2. **There is no now-line**, on a view where today is one of the seven columns.
   `.now-line` exists in the stylesheet (finding B).
3. **The space chip crowds out the title.** A block reads `[Work] 10:30 Team st…`
   — the chip takes ~40% of the width, the time is repeated from the gutter the
   block is already positioned against, and the actual title truncates to two
   words. Five identical "Team st…" blocks in a row are indistinguishable.
4. **Blocks carry the category colour on all four borders.** The stylesheet
   specifies `border-left: 3px solid` and a hairline elsewhere, with the reason
   written next to it: "filling the block turns a stack into a colour chart."
   The calendar does the thing the stylesheet warns against.

### F. There is no active-route indication anywhere in the navigation

`NavLink` in `Sidebar.tsx` renders an identical `className` regardless of the
current path, and never sets `aria-current`. On `/` the word "Today" in the nav
looks exactly like "Travel". You cannot tell where you are — visually or with a
screen reader.

Compounding it: **"Today" appears twice** in the sidebar, once as the landing
page and once as a smart list with a count, going to two different routes.

### G. "A dense interface is a keyboard interface" — and there are no shortcuts

`globals.css` makes that claim in a comment, to justify the focus ring. The app
has exactly one `addEventListener` in `src/`, and it listens for `online`.

There is no `/` to search, no `c` to capture, no `g` `t` to go to Today, no
`⌘K`. Every dense keyboard-first product Orbit resembles — Linear, Todoist,
Superhuman, Fastmail, Things — treats this as table stakes. The stylesheet makes
a promise the app does not keep.

### H. There is no settings surface at all

`src/app/` has no `settings/` route. There is nowhere to:

- force light or dark (the theme is `prefers-color-scheme` only, with no
  override — a real preference, and the one users ask for most);
- choose a default space for compose;
- see or revoke devices. `devices.revoked_at` exists and **nothing sets it**
  (STATUS edge 4), so device rows accumulate with no way to remove one.

### I. Dates render US-style, against a standing rule

The phase plan's standing rules say "UK conventions throughout" and Phase 5
says "DD/MM never MM/DD". Native `<input type="date">` renders in the *browser*
locale, not the document's `lang="en-GB"` — so the compose bars show
`mm/dd/yyyy` and `07/31/2026`. The app's own formatted output is correctly
DD/MM; only the inputs disagree, which is the worst case, because the two
appear on the same screen.

### J. Row metadata is stranded at the far right

At 1440px, a task's title starts at x≈385 and its due date sits at x≈1870. The
eye travels 1500px to connect "Descale the kettle" to "9 Jul". Dense lists work
when related things are near each other; a full-bleed row at desktop width is
the one case where `.row`'s discipline stops helping. Content wants a
`max-width`, as the handoff specified for Now (`max-width: 46rem`).

### K. Smaller things

- `Good morning, {firstName}` is hardcoded, at every hour of the day.
- The AI "Review the week ahead" panel sits above the actual content on Today.
- The sidebar is ~22 links flat: 11 nav + 8 lists + spaces. Rules, Sync and AI
  are administrative surfaces sitting at the same level as Today and Calendar.

---

## How Orbit compares to similar apps

Two categories overlap here: family organisers (Cozi, Skylight, OurHome,
Picniic) and personal task/PIM tools (Todoist, Things, Apple Reminders,
Fantastical).

| | Cozi | Todoist | Things | Apple | **Orbit** |
|---|---|---|---|---|---|
| Shared calendar, per-member colour | ✓ | – | – | ✓ | **✓** spaces |
| Assign an item to a person | ✓ | ✓ | – | ✓ | **schema only** (D) |
| Shopping / shared list | ✓ | ✓ | – | ✓ | **partial** — checklists inside a task |
| Meal planning | ✓ | – | – | – | ✗ |
| Chore rotation | ✓ | ✓ | – | – | **rules engine could** |
| Natural-language capture | – | ✓ cloud | ✓ | ✓ | **✓ on-device** |
| Recurring with per-occurrence exceptions | ✓ | ✓ | ✓ | ✓ | **✓** skip + restore |
| Offline edits | – | ✓ | ✓ | ✓ | **✓** |
| Conflicts named, never auto-resolved | – | – | – | – | **✓ unique** |
| Free/busy-only sharing | – | – | – | ✓ | **✓** |
| End-to-end encrypted items | – | – | – | – | **✓ modelled** |
| Command palette / shortcuts | – | ✓ | ✓ | – | ✗ (G) |
| Usable on a phone | ✓ | ✓ | ✓ | ✓ | **✗ (A)** |

**Read the table honestly.** Orbit is *ahead* of every product listed on
privacy, sharing granularity, on-device parsing and conflict honesty — the hard
things, the ones that need architecture. It is behind on the everyday household
verbs and on being reachable from a phone — the easy things, the ones that need
an afternoon each.

That is a good problem. The expensive half is done.

---

## Plan

Ordered by (value × fit with the standing rules) ÷ cost. Every item respects:
no streaks, no badges, no gamification, no guilt, no view tracking; category
colour is the only strong colour and never appears without an icon and a label;
calm, dense, neutral, full dark mode, UK conventions.

### 1. Make Orbit work on a phone — finding A

The whole of finding A. A `viewport` export; the sidebar becomes a drawer below
`md` with a bottom tab bar for the five surfaces that matter; rows reflow so the
title is never the thing that gets dropped; the calendar week collapses to a day
column on small screens; a manifest and `theme-color` so it installs.

### 2. Build the Now page — findings B, C, J

Spend the dead stylesheet. A range switch (`.seg`) on `?range=today|week|month`;
a summary strip (`.stat`) whose numbers and lists come from one query so they
cannot disagree; an agenda of **today's actual events** (`.block`, `.block-time`,
category colour on the left edge only) with the now-line (`.now-line`) in
position; the due list beneath. Constrained to a readable measure.

### 3. Active navigation state — finding F

`aria-current="page"` and a visible treatment. Resolve the duplicate "Today".

### 4. Surface assignment — finding D

Who a task is for, on the row. Settable at compose. A "Mine" smart list against
the index that already exists. Avatar-free: initials plus name, colour only as
reinforcement.

### 5. Calendar repairs — finding E

Scroll to now on open; render the now-line; drop the redundant in-block time and
demote the space chip so the title survives; move category colour to the left
edge as the stylesheet specifies.

### 6. Keyboard shortcuts and a command palette — finding G

`/` search, `c` capture, `g` then `t`/`c`/`p`/`n` to go, `?` for the help sheet,
`⌘K`/`Ctrl-K` for the palette. Every shortcut discoverable from `?`; none of
them the only way to do anything.

### 7. Settings — finding H

Theme override (system / light / dark, persisted, no flash), default compose
space, week start, and a device list that can finally set `devices.revoked_at`.

### 8. UK date inputs and the small things — findings I, K

### Beyond this session

- **Shared lists** (shopping) as a first-class kind — the one household verb
  genuinely missing, and the only item here needing a migration.
- **A scheduler**, so a `schedule` rule runs on a schedule (STATUS edge 16).
  This is also what makes chore rotation possible without gamification.
- **Undo**, starting with the dismissed conflict that currently loses an edit
  (STATUS edge 7, "the one with the most teeth").
- **Location reminders** — places and rules both already exist.
