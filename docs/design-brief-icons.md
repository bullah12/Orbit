# Brief: an app icon for Orbit

A self-contained prompt. Paste the whole of it — it carries everything the
answer needs, so nobody has to read the repository first.
`docs/design-brief-prompt.md` §1 is the short version of this; this is the one
to hand to a designer or a model.

---

## The prompt

> You are designing the app icon for **Orbit**, a household organiser that two
> people share. I need a mark and a full icon set. Read the whole brief before
> you start, and tell me what you rejected as well as what you chose.
>
> ### What Orbit is
>
> Tasks, notes, people, places and a calendar, kept in **spaces** — a space is a
> group of people who can see the same things, so "Personal" is one, "Home" is
> another, "Work" is another. Everything anybody makes lives in exactly one of
> them, and that is the whole sharing model.
>
> It is a **calm** thing. It is not a productivity tool that wants to be opened;
> it is the place the bins-out reminder goes so nobody has to remember it. The
> most common single action is capturing one line of text — "dinner with Sadia
> on Saturday at 7pm" — and then not thinking about it again. Two people, a
> household, years of use. Nothing gamified, no streaks, no badge counts.
>
> ### What it looks like already
>
> Flat and quiet, and deliberately so. There are no shadows anywhere in the
> interface except a focus ring and a map-pin halo; elevation is expressed by a
> hairline and a slightly different surface, never by a drop shadow. Type is
> small and dense. The palette is greyscale chrome with a trace of blue in it,
> plus one accent and ten category colours that belong to spaces, not to the
> app.
>
> The chrome, as `oklch(L C H)`, light value first:
>
> ```
> background   oklch(98.6% 0.002 265)   /   oklch(16.5% 0.008 265)
> raised       oklch(100%  0     0  )   /   oklch(21%   0.010 265)
> text         oklch(22%   0.014 265)   /   oklch(95%   0.004 265)
> hairline     oklch(89%   0.006 265)   /   oklch(30%   0.010 265)
> accent       oklch(48%   0.14  258)   /   oklch(76%   0.12  258)   ← the only brand-ish colour
> ```
>
> The ten space colours are rose, orange, amber, lime, emerald, sky, indigo,
> violet, fuchsia and slate, all at roughly `oklch(50% 0.13–0.19 h)` in light.
> **Do not introduce a new brand colour.** The accent above, the greyscale, or
> one of the ten. If you use a space colour, say which and why.
>
> ### The problem
>
> Orbit is installable as a web app — `src/app/manifest.ts` sets
> `display: standalone` — and it declares **no icons at all**, because there is
> no artwork in the repository. Installing it today puts a blank letter tile on
> somebody's home screen. That tile is the only thing about Orbit most people
> will see ten times a day.
>
> ### What to deliver
>
> 1. **The concept, in a paragraph.** Why this mark suits a calm household
>    organiser rather than a task app that wants attention. What it is *not*
>    doing, and what you rejected on the way.
>
> 2. **SVG source**, square canvas, `viewBox="0 0 512 512"`. It has to be
>    readable at 512px, at 48px, and as a 16px favicon. Test it at 16px before
>    you send it; most marks die there and the answer is usually one fewer
>    element.
>
> 3. **A maskable variant.** Android crops icons to whatever shape the launcher
>    likes, so the mark must sit inside the inner **80% circle** safe zone with
>    the background running to all four edges. Deliver this as a separate SVG,
>    not a note saying the first one will do.
>
> 4. **Light and dark treatments.** The app follows the OS, and the tile does
>    not — so say which one is the tile, and whether the mark holds up on both a
>    white and a near-black launcher wallpaper.
>
> 5. **A monochrome variant** for the platforms that ask for one (a single
>    colour on transparent, no fills that vanish when it is flattened).
>
> 6. **The exact `icons` array** to paste into `manifest.ts`, with `src`,
>    `sizes`, `type` and `purpose` for each entry, plus the PNG sizes to export
>    and where they go in `public/`. Also tell me whether `background_color` and
>    `theme_color` should change from their current `#f9fafb`, and if so to what.
>
> 7. **A favicon**, and say whether it is the mark or a simplification of it.
>
> ### Constraints, all of them real
>
> - **No text in the mark.** Not a letter O, not a monogram. It has to work
>   beside apps in languages this household does not read.
> - **No gradients that die small.** A two-stop gradient across 512px is a flat
>   muddy colour at 48px. If you use one, show me the 48px render.
> - **No shadows or bevels.** The whole interface is flat; a glossy tile in front
>   of it would be a promise the app does not keep.
> - **It must survive being one of thirty icons on a cluttered home screen**,
>   next to the platform's own apps, at a glance, by silhouette. Shape first,
>   colour second.
> - **Use the palette above**, not a new one.
> - **Not a checkmark, not a clock, not a calendar page.** Those are the three
>   obvious answers and every organiser on the phone already has one. If you
>   come back with one anyway, justify it against the alternatives.
>
> ### How to answer
>
> Reasoning, not just output. For each decision, what it cost and what you
> turned down. Show the mark at 512, 128, 48 and 16, and the maskable variant
> inside its safe-zone circle. If one of these constraints is wrong, argue it —
> I would rather change the brief than get an icon that fights it.

---

## What to do with the answer

The SVGs go in `public/`, the PNG exports beside them, and the `icons` array
into `src/app/manifest.ts` — which currently ends with this comment, and that
comment is the thing being deleted:

```ts
/**
 * No icons are declared. An icon here that does not exist is a broken image on
 * somebody's home screen, which is worse than the letter the platform draws
 * for itself — and there is no artwork in this repository to point at.
 */
```

Check the result the way everything else here is checked: install it on a real
phone, put it on a home screen next to the other apps, and look at it from
arm's length. A mark that needs to be explained has failed.
