/**
 * Initials in a circle, tinted from the category ramp.
 *
 * The ramp rather than a new palette: a person's category is already the thing
 * colour means about them everywhere else in the app, and a second colour
 * system for avatars would make the same person two different colours on two
 * screens. Uncategorised falls to slate, which is the ramp's own neutral.
 *
 * Colour is never the cue on its own — the initials are in the circle and the
 * name is beside it. `aria-hidden`, because the name is right there and a
 * screen reader announcing "PR" before it is noise.
 */
export function PersonAvatar({
  name,
  colour,
  size = 44,
}: {
  name: string;
  /** A category colour name, or null for an uncategorised person. */
  colour: string | null;
  size?: number;
}) {
  const c = colour ?? 'slate';
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        color: `var(--c-${c}, var(--c-slate))`,
        background: `var(--c-${c}-bg, var(--c-slate-bg))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** At most two, from the first and last word — "Priya Raman" is PR. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}
