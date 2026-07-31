import Link from 'next/link';
import { RANGES, type Range } from '@/lib/queries/summary';

const LABELS: Record<Range, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
};

/**
 * Today / Week / Month, the one control on Now.
 *
 * Selection is carried by three signals and not one of them is hue: a raised
 * surface, a stronger border, and weight 600. That is deliberate — this sits
 * directly above ten coloured chips, and a blue pill here would be competing
 * with the only thing colour is allowed to mean in Orbit.
 *
 * `aria-current` is both the accessible answer and the styling hook, so the two
 * cannot drift apart: there is no `selected` class to forget to update.
 *
 * These are links rather than buttons because the range lives in the URL — it
 * has to survive a reload and be sendable to the other person in the household.
 * `.seg > *` styles whatever the children are, so the stylesheet does not care.
 */
export function RangeSwitch({ range }: { range: Range }) {
  return (
    <div
      // Intrinsic width is ~162px. Anything that can squeeze it clips "Month"
      // to "Mont", which is why this is flex:none with nowrap and the header
      // above it is allowed to wrap instead.
      className="seg shrink-0 whitespace-nowrap"
      role="group"
      aria-label="Range"
    >
      {RANGES.map((r) => (
        <Link
          key={r}
          href={r === 'today' ? '/' : `/?range=${r}`}
          aria-current={r === range ? 'true' : undefined}
          // scroll={false} keeps the agenda where it was when the range changes
          // under it — the page is the same shape at all three grains.
          scroll={false}
        >
          {LABELS[r]}
        </Link>
      ))}
    </div>
  );
}
