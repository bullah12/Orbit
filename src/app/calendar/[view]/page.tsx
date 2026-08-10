import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { formatDate, formatLongDate, plural, type DateOnly } from '@/lib/format';
import { DayColumns } from '@/components/calendar/DayColumns';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { type WeekStart } from '@/lib/prefs';
import { readWeekStart } from '@/lib/prefs/cookies';
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
  const user = await requireUser();
  const today = todayFor();
  const anchor = normaliseDate(date) ?? today;

  const weekStart = await readWeekStart();

  const { from, to } = viewRange(view, anchor, weekStart);
  const [spaces, items, categories, calendars] = await Promise.all([
    listSpaces(user.id),
    listCalendarItems(user.id, from, to),
    categoriesBySpace(user.id),
    listCalendarsBySpace(user.id),
  ]);

  const days =
    view === 'month' ? monthGrid(anchor, weekStart).flat()
    : view === 'week' ? weekDays(anchor, weekStart)
    : [anchor];
  const opaque = spaces.filter((s) => !s.canRead);
  const busyCount = items.filter((i) => i.isBusy).length;

  return (
    <div className="flex h-screen flex-col">
      {/* Two rows, not one wrapping line of five controls. The title and the
          period stepper are what you look at; the view switch is what you
          press, and at 390px it gets a row to itself rather than being the
          thing that wraps. */}
      <header className="hairline shrink-0 border-b px-5 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-lg md:tracking-normal">
              {titleFor(view, anchor, weekStart)}
            </h1>
            <p className="muted mt-1 text-sm md:mt-0.5 md:text-xs">
              {/* On the day view the heading is the month, so the date has to be
                  said here or the screen never names the day you are looking at. */}
              {view === 'day' && `${formatLongDate(anchor)} · `}
              {plural(items.length - busyCount, 'event')}
              {busyCount > 0 && `, ${plural(busyCount, 'busy block')}`}
              {' across '}
              {plural(spaces.length, 'space')}
            </p>
          </div>

          <nav className="flex shrink-0 items-center gap-1" aria-label="Calendar period">
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

          {/* Icon-only on a phone: it is the least-used control on the busiest
              header in the app, and the word costs a third of the row. */}
          <Link
            href="/calendar/import"
            aria-label="Import a calendar"
            className="hairline row-hover flex shrink-0 items-center gap-1 rounded border p-1.5 text-xs md:px-2 md:py-1"
          >
            <Icon name="calendar" size={13} className="muted" />
            <span className="hidden md:inline">Import</span>
          </Link>
        </div>

        {/* One control, not three buttons that each look like an action.
            `.seg` is the shape the app already uses for a small closed set of
            peer options — the range switch on Home — and Day/Week/Month is the
            same idea about a different noun. The accent fill it used to carry
            made the current view look like the thing you were about to press.

            Still links: the view is a route, so it survives a reload, it can
            be sent to somebody, and the back button means what it says. */}
        <nav className="seg mt-3 flex-none whitespace-nowrap" aria-label="Calendar view">
          {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
            <Link
              key={v}
              href={`/calendar/${v}?date=${anchor}`}
              aria-current={v === view ? 'page' : undefined}
              className="capitalize"
            >
              {v}
            </Link>
          ))}
        </nav>
      </header>

      {/* The date picker, on a phone.
          Prev/Today/Next moves a whole period at a time, which is the wrong
          grain when what you want is Thursday. A strip of the anchor's week is
          the smallest control that answers that directly, and it doubles as
          the "where am I" the header title states in words. It stays in the
          current view — picking a day on the week grid should not throw you
          into the day grid. Hidden from `md` up, where the grid itself is
          wide enough to click a day in. */}
      <WeekStrip view={view} anchor={anchor} today={today} weekStart={weekStart} />

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

      {/* Desktop only, as on Home and Tasks. Unlike a person, an event is
          something the capture button can create — “dentist Tuesday at 3” —
          so nothing is out of reach on a phone. */}
      <div className="hidden md:block">
        <ComposeEvent spaces={spaces} categories={categories} calendars={calendars} defaultDate={anchor} />
      </div>

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
        <MonthGrid anchor={anchor} items={items} today={today} weekStart={weekStart} />
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

/**
 * Seven days across, the anchor's own week, as the phone's date picker.
 *
 * Each day keeps the current view rather than forcing `day` — somebody
 * skimming the week grid who taps Thursday wants the week grid scrolled to
 * Thursday, not a different page. Today is marked separately from the
 * selection, because on any day but this one they are two different squares
 * and a picker that conflates them is lying about one of them.
 */
function WeekStrip({
  view,
  anchor,
  today,
  weekStart,
}: {
  view: CalendarView;
  anchor: DateOnly;
  today: DateOnly;
  weekStart: WeekStart;
}) {
  const days = weekDays(anchor, weekStart);
  const initial = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });

  return (
    <nav
      aria-label="Pick a day"
      className="hairline grid grid-cols-7 border-y px-4 py-3 md:hidden"
      style={{ background: 'var(--bg-sunken)' }}
    >
      {days.map((d) => {
        const selected = d === anchor;
        const isToday = d === today;
        return (
          <Link
            key={d}
            href={`/calendar/${view}?date=${d}`}
            aria-current={selected ? 'date' : undefined}
            aria-label={formatDate(d)}
            className="flex flex-col items-center gap-1"
          >
            <span
              className={selected ? 'text-xs font-semibold' : 'muted text-xs'}
            >
              {initial.format(new Date(`${d}T00:00:00Z`)).slice(0, 1)}
            </span>
            <span
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-lg tabular-nums"
              style={
                isToday
                  ? {
                      background: 'var(--accent)',
                      color: 'var(--accent-text)',
                      fontWeight: 600,
                      boxShadow: '0 0 12px var(--accent-glow)',
                    }
                  : selected
                    ? { fontWeight: 600, boxShadow: 'inset 0 0 0 1px var(--line-strong)' }
                    : { color: 'var(--text-faint)' }
              }
            >
              {Number(d.slice(8, 10))}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function titleFor(view: CalendarView, anchor: DateOnly, weekStart: WeekStart): string {
  // The month, not `10/08/2026`. A numeric date is the one thing the screen
  // does not need spelled at 26px — the week strip below is already showing
  // which day is selected, and the subtitle says it in words.
  if (view === 'day') {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', month: 'long', year: 'numeric',
    }).format(new Date(`${anchor}T00:00:00Z`));
  }
  if (view === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', month: 'long', year: 'numeric',
    }).format(new Date(`${anchor}T00:00:00Z`));
  }
  const days = weekDays(anchor, weekStart);
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
