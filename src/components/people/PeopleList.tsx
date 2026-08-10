import Link from 'next/link';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Icon } from '@/components/Icon';
import { PersonAvatar } from './PersonAvatar';
import { formatDueDate, plural } from '@/lib/format';
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
            className="row-hover flex min-h-[68px] items-center gap-3.5 px-5 py-3"
          >
            {p.isLocked ? (
              // The lock is the avatar. An initials circle for a record whose
              // name the server has never seen would be inventing two letters.
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'var(--c-slate-bg)', color: 'var(--c-slate)' }}
              >
                <Icon name="lock" size={20} />
              </span>
            ) : (
              <PersonAvatar name={p.displayName} colour={p.category?.colour ?? null} />
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg">
                {p.isLocked ? (
                  <em className="muted">Locked person</em>
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

              {p.isLocked ? (
                <span
                  className="faint mt-0.5 block truncate font-mono text-sm"
                >
                  opens on this device only
                </span>
              ) : (
                // One line, and the category lives *in* it rather than as a
                // chip on the right. The right-hand end of the row belongs to
                // the space indicator, which is the thing that has to be on
                // every row; a second coloured chip beside it was two colours
                // competing to mean two different things at the same size.
                <span className="muted mt-0.5 flex items-center gap-2 truncate text-sm">
                  {p.category && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1"
                      style={{ color: `var(--c-${p.category.colour}, var(--c-slate))` }}
                    >
                      <Icon name={p.category.icon} size={12} strokeWidth={2} />
                      {p.category.name}
                    </span>
                  )}
                  {p.category && personDetail(p) && <span aria-hidden="true">·</span>}
                  {personDetail(p) && <span className="truncate">{personDetail(p)}</span>}
                  {p.linkCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className="inline-flex shrink-0 items-center gap-1"
                        title="Also has a record in another space"
                      >
                        <Icon name="link" size={11} />
                        linked
                      </span>
                    </>
                  )}
                </span>
              )}
            </span>

            {!p.isLocked && <SpaceIndicator space={p.space} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The middle of the one line under the name — what sits after the category.
 *
 * Exported because the map's bottom sheet shows the same sentence about the
 * same person: two surfaces describing one row should not describe it
 * differently.
 *
 * Ordered by what somebody is most likely to be scanning for, and it is only
 * ever one of them: where they live, then the date that is coming up, then how
 * much contact detail is on file. A row that tried to show all three is the row
 * this replaced.
 */
export function personDetail(p: PersonRow): string {
  if (p.homePlaceName) return p.homePlaceName;
  if (p.nextDate) {
    const when = formatDueDate(nextOccurrence(p.nextDate.onDate));
    return `${p.nextDate.label ?? p.nextDate.kind} ${when}`;
  }
  if (p.contactCount > 0) return plural(p.contactCount, 'contact');
  return '';
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
