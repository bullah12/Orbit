import Link from 'next/link';

/**
 * Today / Week / Month, on Now rather than on the calendar.
 *
 * The instinct is to put these words on the calendar, because that is where
 * they live in other products. But the calendar is a placement tool and this
 * page answers a question — what do I need to deal with — at three grains. Same
 * query, same layout, one parameter.
 *
 * Links rather than buttons: the range lives in the URL, so it survives a
 * reload, it can be sent to somebody, and the back button means what it says.
 *
 * Selection is carried by three signals and none of them is hue — a raised
 * surface, a stronger edge and weight 600 — because `.seg` sits directly above
 * ten coloured space chips and must not compete with them. `aria-current` is
 * the styling hook, so what the eye sees and what a screen reader is told
 * cannot drift apart.
 */

export const RANGES = ['today', 'week', 'month'] as const;
export type Range = (typeof RANGES)[number];

const LABELS: Record<Range, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
};

export function isRange(v: string | undefined): v is Range {
  return v != null && (RANGES as readonly string[]).includes(v);
}

export function RangeSwitch({ current }: { current: Range }) {
  return (
    // `flex-none` and `whitespace-nowrap` because the header wraps around it:
    // squeezed, this control clipped "Month" to "Mont".
    <div className="seg flex-none whitespace-nowrap" role="group" aria-label="Range">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={r === 'today' ? '/' : `/?range=${r}`}
          aria-current={r === current ? 'true' : undefined}
        >
          {LABELS[r]}
        </Link>
      ))}
    </div>
  );
}
