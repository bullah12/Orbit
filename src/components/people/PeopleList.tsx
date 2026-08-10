import Link from 'next/link';
import { SpaceIndicator, CategoryChip } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { PersonAvatar } from './PersonAvatar';
import { formatDueDate } from '@/lib/format';
import type { PersonRow } from '@/lib/queries/people';

/**
 * People, as a list. The default view, and the one that always works.
 *
 * 68px rows: an avatar, a name and one line under it. The old row was a single
 * baseline-aligned line of chips that wrapped unpredictably on a phone — name,
 * "linked", a cake, a category, a space, all competing at 11px. One line of
 * secondary detail and one chip on the right is the same information with a
 * decision made about which of it matters.
 *
 * Locked people keep their treatment: the row is the same shape, so the list
 * does not develop a hole where a person is, and it says why rather than
 * showing a name that is not there.
 */
export function PeopleList({ people }: { people: PersonRow[] }) {
  return (
    <ul id="people-list">
      {people.map((p) => (
        <li key={p.id} className="hairline border-b">
          <Link
            href={`/people/${p.id}` as never}
            className="row-hover flex min-h-[68px] items-center gap-3 px-4 py-2.5"
          >
            <PersonAvatar
              name={p.isLocked ? '?' : p.displayName}
              colour={p.category?.colour ?? null}
            />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-base">
                {p.isLocked ? (
                  <em className="muted inline-flex items-center gap-1.5">
                    <Icon name="lock" size={13} />
                    Locked person
                  </em>
                ) : (
                  <>
                    {p.displayName}
                    {p.nickname && (
                      <span className="ml-1.5 text-sm" style={{ color: 'var(--text-faint)' }}>
                        “{p.nickname}”
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className="muted block truncate text-sm">{secondary(p)}</span>
            </span>

            {/* Two records, linked, never merged (decision 4). This is the one
                piece of the old row that could not fold into the line of
                secondary detail: it is not a fact about the person, it is a
                fact about this *record* — that there is another one — and
                somebody scanning for the reason a name appears twice needs it
                on both rows at once, not behind whichever of them they open. */}
            {p.linkCount > 0 && (
              <span
                className="faint inline-flex shrink-0 items-center gap-1 text-xs"
                title="Also has a record in another space"
              >
                <Icon name="link" size={12} />
                linked
              </span>
            )}
            {!p.isLocked && <CategoryChip category={p.category} />}
            <SpaceIndicator space={p.space} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one line under the name.
 *
 * Ordered by what a person is most likely to be scanning for, and it is only
 * ever one of them: where they live, then the date that is coming up, then the
 * fact that they exist twice. A row that tried to show all three is the row
 * this replaced.
 */
function secondary(p: PersonRow): string {
  if (p.isLocked) return 'Opens on this device only';
  if (p.homePlaceName) return p.homePlaceName;
  if (p.nextDate) {
    const when = formatDueDate(nextOccurrence(p.nextDate.onDate));
    return `${p.nextDate.label ?? p.nextDate.kind} ${when}`;
  }
  // Not the link — that has its own marker on the row, so repeating it here
  // would spend the one secondary line on something already said.
  return p.category?.name ?? '';
}

/** The next time this day-of-year comes round, as an ISO date. */
export function nextOccurrence(onDate: string): string {
  const today = new Date();
  const [, m, d] = onDate.slice(0, 10).split('-');
  const year = today.getUTCFullYear();
  const thisYear = `${year}-${m}-${d}`;
  const todayIso = today.toISOString().slice(0, 10);
  return thisYear >= todayIso ? thisYear : `${year + 1}-${m}-${d}`;
}
