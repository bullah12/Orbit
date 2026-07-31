# Prompt for Claude Code

Copy everything below the line into Claude Code, from the root of the Orbit repo,
with this handoff folder available (e.g. copied to `docs/design-handoff/`).

---

I have a design handoff in `docs/design-handoff/`. Read these first, in order:

1. `docs/design-handoff/README.md` — the spec. Read it fully before writing code.
2. `docs/design-handoff/globals.css` — the revised stylesheet.
3. `docs/design-handoff/contrast.json` and `contrast-map.json` — computed
   contrast ratios for every token pair, both themes.

`docs/design-handoff/Orbit Visual System.dc.html` is a visual reference you can
open in a browser to see the intended result. **Do not port its markup or copy
its inline styles** — it is inline-styled with literal `oklch()` values so it
renders standalone. Real components must read the CSS custom properties from
`globals.css`. Ignore `support.js` entirely; it only exists so that file opens.

This is a revision of a shipped app, not a greenfield build. Work in Orbit's
existing conventions: Next.js App Router, React, Tailwind v4, TypeScript,
existing components in `src/components/`. Reuse what is there; do not introduce a
component library, a CSS-in-JS layer, or a second styling approach.

## Phase 1 — the stylesheet (do this first, ship it on its own)

Replace `src/app/globals.css` with `docs/design-handoff/globals.css` verbatim.
This is intended to be used as-is; it is the artifact being revised. Then:

- Run `pnpm test`. `tests/contrast.test.ts` must pass with **no skipped tokens**.
  Verify the count of parsed tokens rose by the new ones per theme: `--success`,
  `--warning` and their `-bg`s, `--focus-ring`, `--focus-halo`, `--map-water`,
  `--map-land`, `--map-line`. A silently-unparsed token is exactly the failure
  this test exists to catch — if the count did not move, the parser is skipping
  something.
- **Do not rewrite the `@media print` block.** It deliberately uses CSS colour
  keywords on classes and no `oklch()` and no token overrides, because
  `tests/contrast.test.ts` parses this file as text and would treat token
  overrides outside the dark block as light-theme values. The README explains
  this; leave it alone.
- Run `pnpm build` to confirm Tailwind emits the new `text-2xs … text-xl`
  utilities. If a `text-*` class produces no CSS, the `@theme` key is wrong.

Then apply the type-scale codemod across `src/`:

- `text-[10px]` and `text-[11px]` → `text-2xs`
- `text-[12px]` and `text-[12.5px]` → `text-xs`
- `text-[13px]` and `text-[13.5px]` → `text-sm`
- `text-[14px]` → `text-base`
- `text-[15px]` → `text-lg`
- `text-[17px]` → `text-xl`

Roughly 663 sites; only the ~50 former `text-[10px]` ones change visual size (up
1px). Where a class list now carries both a `text-*` size and a redundant
`leading-*`, drop the `leading-*` — line-height travels with the size token now.
Afterwards, scan the sidebar footer and the calendar hour gutter for new
wrapping.

Also in this phase, small and mechanical:

- `SpaceIndicator.tsx` and `CategoryChip.tsx`: replace the ad-hoc chip styling
  with `className="chip"` / `"chip chip-plain"`, keeping the existing inline
  `style` colour variables. Chip geometry should stop being hand-copied.
- Calendar block component: anonymous/external blocks get `className="busy"`
  instead of a colour variable.

Commit phase 1 separately. It is a no-behaviour-change commit.

## Phase 2 — the IA change

Three pages, one shell. Read the README's "Rework required" and "Screens /
views" sections for the reasoning and the exact layout of each.

1. `/` becomes **Now** (currently the calendar). Range state lives in the URL as
   `?range=today|week|month`, default `today`. It must survive reload and be
   linkable.
2. `/calendar` renders the existing grid, restyled per the README. It **loses**
   the Today/Week/Month switch.
3. `/people` is new: map + list of who is where.
4. Navigation drops to three items — Now · Calendar · People — plus settings.
   With three items the dense sidebar is no longer justified; move to a top row
   and give the width back to content.

**Data:** Now must issue exactly one query, `summary(range)`, returning counts,
events and due items in a single response (the `Summary` type is in the README).
One query per page, not one per widget — the summary number and the list beneath
it must not be able to disagree. Add the backend endpoint/resolver if it does not
exist; keep the existing calendar and location queries as they are.

**Build the screens using the new utility classes**, not new bespoke CSS:
`.seg` for the range switch, `.block` / `.block-time` / `.block-now` for agenda
items, `.now-line`, `.stat` / `.stat-num` for the summary, `.map` / `.map-land` /
`.pin` for People, and the existing `.row` / `.section-label` / `.chip` /
`.busy` / `.locked` / `.pending`. If you find yourself writing a new class, first
check whether the README already names one for that job.

Non-negotiable details, all of which came out of design review:

- The range switch's selected state is carried by surface + border + weight 600,
  never hue. Render it as `role="group"` of real buttons with
  `aria-current="true"` on the selected one; `aria-current` is the styling hook.
  Its intrinsic width is ~162px — make sure its container cannot squeeze it
  (clipping "Month" to "Mont" was a real review finding). The Now header must
  wrap rather than compress it.
- Agenda blocks carry the category colour on the **left 3px edge only**. Do not
  fill them.
- The now-line is the only bare accent hairline in the app. One per view.
- Every map pin carries the person's **name**, not just a colour dot, and keeps
  its `box-shadow` halo — that halo is what makes a pin readable when it
  straddles a coastline. Do not remove it as "decorative"; the README explains
  that it and the focus halo are the only two box-shadows in the system.
- Someone with location sharing off renders with `.locked`, still in the list.
  They do not disappear.
- Task checkboxes are optimistic and take `.pending` until acknowledged.
- Conflict actions ("Keep mine" / "Keep theirs") keep equal visual weight.
  Neither is primary.
- No hover-only information anywhere.
- The map placeholder in the reference is a CSS gradient. Ship real geo data.

## Constraints

- No new dependencies without asking, except a map library for `/people` — if
  one is needed, propose it before installing.
- No new global CSS beyond `globals.css`. No CSS modules, no styled-components.
- Do not add a manual theme toggle. Colour scheme comes from
  `prefers-color-scheme`. The README explains what adding one would actually
  cost.
- Do not change the ten category colour names; they are database values.
- Keep priority and status as text, not colour. They are ordinal, not
  categorical, and colour already means "which person / which space".
- Accessibility is part of the definition of done: `:focus-visible` on every
  interactive element, real buttons and links, `aria-current` on the range
  switch, and the skip link kept working.

## Definition of done

- `pnpm test`, `pnpm build`, `pnpm smoke` all green.
- Both colour schemes checked by eye: tab until focus lands on a space chip and
  on a calendar event block — a neutral gap must show inside the ring. Week view
  with a busy block visible: quieter than every real event with no hover.
- The range switch is not clipped at 320px, 375px or 1440px.
- Screenshot the range switch and desaturate it — selection must still be
  obvious with no colour at all.
- Now, Calendar and People all render from real data at all three ranges.

Work in phases and stop for review after phase 1. Tell me anything in the
handoff that conflicts with how the codebase actually works — the spec was
written against the design, not against the repo.
