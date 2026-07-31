import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { categoriesBySpace } from '@/lib/queries/tasks';
import { listCalendarItems, listCalendarsBySpace } from '@/lib/queries/events';
import { stepAnchor, todayFor, viewRange, weekDays } from '@/lib/calendar';
import { plural, type DateOnly } from '@/lib/format';
import { DayColumns } from '@/components/calendar/DayColumns';
import { ComposeEvent } from '@/components/ComposeEvent';
import { Icon } from '@/components/Icon';
import { SpaceIndicator } from '@/components/SpaceIndicator';

export const dynamic = 'force-dynamic';

/**
 * The calendar — the grid.
 *
 * This is a *placement* tool: you arrive already knowing the date, which is why
 * Today / Week / Month does not live here. That control asks a question, and
 * the page that answers questions is Now. Keeping it in both places would split
 * one idea across two surfaces.
 *
 * What is left in the header is navigation, not interrogation: which week, and
 * a way back to this one.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const { date, error } = await searchParams;
  const user = await requireUser();
  const today = todayFor();
  const anchor = normaliseDate(date) ?? today;

  const { from, to } = viewRange('week', anchor);
  const [spaces, items, categories, calendars] = await Promise.all([
    listSpaces(user.id),
    listCalendarItems(user.id, from, to),
    categoriesBySpace(user.id),
    listCalendarsBySpace(user.id),
  ]);

  const days = weekDays(anchor);
  const opaque = spaces.filter((s) => !s.canRead);
  const busyCount = items.filter((i) => i.isBusy).length;

  return (
    <div className="flex h-[calc(100vh-2.75rem)] flex-col">
      <header className="hairline flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-5 py-2.5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Week {isoWeek(days[0]!)}</h1>
          <p className="muted tabular text-xs">
            {weekLabel(days)} · {plural(items.length - busyCount, 'event')}
            {busyCount > 0 && `, ${plural(busyCount, 'busy block')}`}
          </p>
        </div>

        <nav className="ml-auto flex items-center gap-1" aria-label="Calendar period">
          <PeriodLink date={stepAnchor('week', anchor, -1)} label="Previous week" flip />
          <Link
            href="/calendar"
            className="hairline row-hover rounded-md border px-2 py-1 text-sm"
          >
            Today
          </Link>
          <PeriodLink date={stepAnchor('week', anchor, 1)} label="Next week" />
        </nav>

        <Link
          href="/calendar/import"
          className="hairline row-hover flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
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
          style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
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

      <DayColumns days={days} items={items} today={today} view="week" />

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

function PeriodLink({ date, label, flip = false }: { date: DateOnly; label: string; flip?: boolean }) {
  return (
    <Link
      href={`/calendar?date=${date}`}
      aria-label={label}
      className="hairline row-hover rounded-md border p-1"
    >
      <Icon name="arrow_right" size={13} className={flip ? 'muted rotate-180' : 'muted'} />
    </Link>
  );
}

function weekLabel(days: DateOnly[]): string {
  const fmt = (iso: DateOnly, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', day: 'numeric', month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(new Date(`${iso}T00:00:00Z`));
  return `${fmt(days[0]!, false)} – ${fmt(days[6]!, true)}`;
}

/** ISO-8601 week number: weeks belong to the year holding their Thursday. */
function isoWeek(iso: DateOnly): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7),
  );
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/** A date from the query string is user input; anything else falls back to today. */
function normaliseDate(v: string | undefined): DateOnly | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : v;
}
