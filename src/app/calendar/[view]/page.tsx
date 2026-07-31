import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { categoriesBySpace } from '@/lib/queries/tasks';
import { listCalendarItems, listCalendarsBySpace } from '@/lib/queries/events';
import {
  isCalendarView,
  monthGrid,
  stepAnchor,
  todayFor,
  viewRange,
  weekDays,
  type CalendarView,
} from '@/lib/calendar';
import { formatDate, plural, type DateOnly } from '@/lib/format';
import { DayColumns } from '@/components/calendar/DayColumns';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { ComposeEvent } from '@/components/ComposeEvent';
import { Icon } from '@/components/Icon';
import { SpaceIndicator } from '@/components/SpaceIndicator';

export const dynamic = 'force-dynamic';

/**
 * The merged calendar.
 *
 * Merged means every space the caller can read, in one grid, told apart by the
 * space indicator rather than by being in separate calendars. A `free_busy`
 * space contributes anonymous blocks and nothing else — and it contributes
 * them from `app.free_busy_blocks()`, not from a filtered read of `events`.
 * There is no client-side filtering anywhere on this page; if a row should not
 * be here, the fix is a policy.
 */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const { view } = await params;
  if (!isCalendarView(view)) notFound();

  const { date, error } = await searchParams;

  // The week is the calendar, and it lives at /calendar. This route carries the
  // two grains that page deliberately does not offer. The date has to survive
  // the move — an old link to a particular week is still a link to that week.
  if (view === 'week') {
    const carried = new URLSearchParams();
    if (date) carried.set('date', date);
    if (error) carried.set('error', error);
    const qs = carried.toString();
    redirect(qs ? `/calendar?${qs}` : '/calendar');
  }
  const user = await requireUser();
  const today = todayFor();
  const anchor = normaliseDate(date) ?? today;

  const { from, to } = viewRange(view, anchor);
  const [spaces, items, categories, calendars] = await Promise.all([
    listSpaces(user.id),
    listCalendarItems(user.id, from, to),
    categoriesBySpace(user.id),
    listCalendarsBySpace(user.id),
  ]);

  // The week redirected away above, so only the two remaining grains are here.
  const days = view === 'month' ? monthGrid(anchor).flat() : [anchor];
  const opaque = spaces.filter((s) => !s.canRead);
  const busyCount = items.filter((i) => i.isBusy).length;

  return (
    <div className="flex h-screen flex-col">
      <header className="hairline flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold">{titleFor(view, anchor)}</h1>
          <p className="muted mt-0.5 text-xs">
            {plural(items.length - busyCount, 'event')}
            {busyCount > 0 && `, ${plural(busyCount, 'busy block')}`}
            {' across '}
            {plural(spaces.length, 'space')}
          </p>
        </div>

        <nav className="ml-auto flex items-center gap-1" aria-label="Calendar period">
          <PeriodLink
            view={view}
            date={stepAnchor(view, anchor, -1)}
            label={`Previous ${view}`}
            icon="arrow_right"
            flip
          />
          <Link
            href={`/calendar/${view}`}
            className="hairline row-hover rounded border px-2 py-1 text-xs"
          >
            Today
          </Link>
          <PeriodLink
            view={view}
            date={stepAnchor(view, anchor, 1)}
            label={`Next ${view}`}
            icon="arrow_right"
          />
        </nav>

        {/*
          No Day/Week/Month switch anywhere in the calendar — that control asks
          a question and belongs to Now. What is left is one way back to the
          week, which is navigation rather than a range.
        */}
        <Link
          href="/calendar"
          className="hairline row-hover rounded-md border px-2 py-1 text-sm"
        >
          Back to the week
        </Link>

        <Link
          href="/calendar/import"
          className="hairline row-hover flex items-center gap-1 rounded border px-2 py-1 text-xs"
        >
          <Icon name="calendar" size={12} className="muted" />
          Import
        </Link>
      </header>

      {error && (
        <p
          role="alert"
          id="calendar-error"
          className="hairline border-b px-5 py-2 text-xs"
          style={{ background: 'var(--c-amber-bg)', color: 'var(--c-amber)' }}
        >
          {error}
        </p>
      )}

      <ComposeEvent spaces={spaces} categories={categories} calendars={calendars} defaultDate={anchor} />

      {opaque.length > 0 && (
        <div className="hairline muted flex flex-wrap items-center gap-2 border-b px-5 py-1.5 text-xs">
          <Icon name="eye_off" size={12} className="faint" />
          <span>Availability only, shown as anonymous blocks:</span>
          {opaque.map((s) => (
            <SpaceIndicator key={s.id} space={s} />
          ))}
        </div>
      )}

      {view === 'month' ? (
        <MonthGrid anchor={anchor} items={items} today={today} />
      ) : (
        <DayColumns days={days} items={items} today={today} view={view} />
      )}

      {spaces.length === 0 && (
        <div className="muted px-5 py-10 text-sm">
          <p className="mb-1">You are not a member of any space.</p>
          <p className="faint text-xs">
            Nothing is hidden from you here — there is genuinely nothing to show.
          </p>
        </div>
      )}
    </div>
  );
}

function PeriodLink({
  view,
  date,
  label,
  icon,
  flip = false,
}: {
  view: CalendarView;
  date: DateOnly;
  label: string;
  icon: string;
  flip?: boolean;
}) {
  return (
    <Link
      href={`/calendar/${view}?date=${date}`}
      aria-label={label}
      className="hairline row-hover rounded border p-1"
    >
      <Icon name={icon} size={13} className={flip ? 'muted rotate-180' : 'muted'} />
    </Link>
  );
}

function titleFor(view: CalendarView, anchor: DateOnly): string {
  if (view === 'day') return formatDate(anchor);
  if (view === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', month: 'long', year: 'numeric',
    }).format(new Date(`${anchor}T00:00:00Z`));
  }
  const days = weekDays(anchor);
  const fmt = (iso: DateOnly, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', day: 'numeric', month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(new Date(`${iso}T00:00:00Z`));
  return `${fmt(days[0]!, false)} – ${fmt(days[6]!, true)}`;
}

/** A date from the query string is user input; anything else falls back to today. */
function normaliseDate(v: string | undefined): DateOnly | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : v;
}
