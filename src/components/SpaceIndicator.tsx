import { Icon } from './Icon';

/**
 * The space indicator.
 *
 * A hard requirement: it appears on every row and every compose surface, and it
 * must be legible at a glance. Three parts, always together —
 *
 *   colour  tells spaces apart quickly, once you know them
 *   icon    tells them apart when the colours are hard to distinguish
 *   label   tells them apart when you have never seen this screen before
 *
 * There is no colour-only variant, deliberately. If a row is too dense to fit
 * the label, the row is too dense.
 */

export type SpaceRef = {
  id: string;
  name: string;
  shortLabel: string;
  colour: string;
  icon: string;
};

export function SpaceIndicator({
  space,
  size = 'sm',
}: {
  space: SpaceRef;
  size?: 'sm' | 'md';
}) {
  const fg = `var(--c-${space.colour}, var(--c-slate))`;
  const bg = `var(--c-${space.colour}-bg, var(--c-slate-bg))`;

  return (
    <span
      className={
        size === 'sm'
          ? 'chip shrink-0'
          : // The stylesheet defines one chip geometry, and .chip lands after the
            // Tailwind utilities in the cascade, so a larger variant cannot be
            // built by overriding it. The header-sized indicator keeps its own
            // measurements until the system names a second size.
            'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium'
      }
      style={{ color: fg, background: bg }}
      title={`Space: ${space.name}`}
    >
      <Icon name={space.icon} size={size === 'sm' ? 11 : 13} strokeWidth={2} />
      {space.shortLabel}
    </span>
  );
}

/**
 * Category chip. Category colour is the only strong colour in Orbit, and this
 * is the component that spends it — never without the icon and the name.
 */
export function CategoryChip({
  category,
}: {
  category: { name: string; colour: string; icon: string } | null;
}) {
  if (!category) return null;
  return (
    <span
      className="chip chip-plain shrink-0"
      style={{ color: `var(--c-${category.colour}, var(--c-slate))` }}
    >
      <Icon name={category.icon} size={11} strokeWidth={2} />
      {category.name}
    </span>
  );
}
