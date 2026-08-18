import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { categoriesBySpace, listTasks } from '@/lib/queries/tasks';
import { listCalendarItems } from '@/lib/queries/events';
import { yesterdaySummary } from '@/lib/queries/notes';
import { upcomingDates } from '@/lib/queries/people';
import { TaskRow } from '@/components/TaskRow';
import { ComposeTask } from '@/components/ComposeTask';
import { Icon } from '@/components/Icon';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { Agenda } from '@/components/Agenda';
import { RangeSwitch, isRange, type Range } from '@/components/RangeSwitch';
import { SearchButton } from '@/components/SearchButton';
import {
  addDaysISO,
  formatDate,
  formatLongDate,
  londonDayISO,
  londonMidnight,
  plural,
  todayISO,
  type DateOnly,
} from '@/lib/format';
import { AiResult } from '@/components/AiResult';
import { listConsents } from '@/lib/queries/ai';
import { runAiFeatureFor } from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * How many days each range covers, starting today. Month is a rolling 30.
 *
 * `all` is a year rather than everything, and the number is a real constraint
 * rather than a shrug: `listCalendarItems` *expands* recurrence across the
 * window it is given, so a daily event costs one row per day of it. Ten years
 * of "all" would be three and a half thousand rows for one repeating event, to
 * render a page nobody scrolls to the end of. A year is the longest window that
 * stays honest about the cost, and the header says so rather than implying the
 * calendar has no horizon.
 */
const SPAN: Record<Range, number> = { today: 1, week: 7, month: 30, all: 365 };

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; answer?: string; refused?: string; range?: string }>;
}) {
  const { sent, answer, refused, range: rawRange } = await searchParams;
  const range: Range = isRange(rawRange) ? rawRange : 'today';

  const user = await requireUser();
  const today = todayISO();

  const [spaces, categories, dueNow, overdue, allOpen, items, yesterday, dates, consents] =
    await Promise.all([
      listSpaces(user.id),
      categoriesBySpace(user.id),
      listTasks(user.id, 'today', { limit: 100 }),
      listTasks(user.id, 'overdue', { limit: 100 }),
      // Only asked for on All. The other three ranges do not render it, and a
      // query nobody reads is a round trip nobody should pay for — this page
      // already costs more of them than anything else in the app.
      range === 'all' ? listTasks(user.id, 'all', { limit: 200 }) : Promise.resolve([]),
      // The events this page has been missing since Phase 0. It answered "what
      // is due" and "whose birthday is near" but never "what is on", which is
      // the question a household calendar exists to answer.
      listCalendarItems(
        user.id,
        londonMidnight(today),
        londonMidnight(addDaysISO(today, SPAN[range])),
      ),
      yesterdaySummary(user.id),
      upcomingDates(user.id, range === 'today' ? 21 : SPAN[range]),
      listConsents(user.id),
    ]);

  // A day per row of the window, except on All — 365 headings, 360 of them
  // empty, is not a list. `Agenda` drops the days with nothing on them anyway,
  // so handing it exactly the days that have something is the same page for a
  // fraction of the work.
  const days: DateOnly[] =
    range === 'all'
      ? [...new Set(items.map((i) => londonDayISO(i.startsAt)))].sort()
      : Array.from({ length: SPAN[range] }, (_, i) => addDaysISO(today, i));

  // Consent is per feature *and* per space, so a weekly review is offered once
  // per space rather than once. There is no "all my spaces" version: a review
  // that read three spaces on one consent would be the consent meaning more
  // than it said.
  const reviews = consents.filter((c) => c.feature === 'weekly_review');

  // The `today` smart list is "due today, **or** overdue and still open", so it
  // is a superset of `overdue`. Splitting them is what makes the strip true:
  // counting the whole of `today` as "due" and the leftover as "overdue"
  // reported 35 due and 0 overdue on a day when 34 of the 35 were months past
  // their date, and the sidebar said 34 two inches away.
  const overdueIds = new Set(overdue.map((t) => t.id));
  const dueToday = dueNow.filter((t) => !overdueIds.has(t.id));

  // On All, "everything still open" is a superset of both sections above it, so
  // the ones already rendered come out — otherwise a task due today is listed
  // twice on one screen and the counts stop agreeing with the lists.
  const dueIds = new Set(dueNow.map((t) => t.id));
  const restOpen = allOpen.filter((t) => !dueIds.has(t.id));

  // Every number in the strip is the length of a list this page renders, which
  // is the whole reason for counting here rather than asking the database
  // separately: a summary that disagrees with what is underneath it is worse
  // than no summary, and this one cannot.
  const counts = {
    events: items.length,
    tasks: dueToday.length,
    overdue: overdue.length,
    // Same rule, one range further: the number is the length of the list this
    // page renders underneath it, plus the two it renders above.
    open: restOpen.length + dueToday.length + overdue.length,
  };

  return (
    <div className="measure flex min-h-screen flex-col">
      {/* The header must wrap: the switch is `flex-none` and nowrap because
          squeezed it clipped "Month" to "Mont". */}
      {/* The design puts the range switch on a row of its own rather than to
          the right of a 30px heading: at 390px the two do not fit side by side,
          and a switch that wraps under a title is a switch that looks like it
          fell off it. */}
      <header className="flex items-start gap-2 px-5 pb-4 pt-2">
        <div className="min-w-0 flex-1">
          {/* 30px on a phone. This is the one heading in the app somebody
              reads from across a kitchen, and at 17px it was the same size as
              a section label two inches below it. Back to the system's page
              title from `md` up, where nothing about the old size was wrong. */}
          <h1 className="text-3xl font-semibold tracking-[-0.02em] md:text-xl md:tracking-tight">
            {range === 'today'
              ? 'Today'
              : range === 'week'
                ? 'This week'
                : range === 'month'
                  ? 'This month'
                  : 'Everything'}
          </h1>
          {/* Spelled out rather than 01/08/2026. A page title is read, not
              scanned down a column, and a numeric date at the top of the app is
              the one place the DD/MM–MM/DD ambiguity actually costs something. */}
          {/* On All the window is not what the eye should read off the header —
              the point of the range is the tasks with no date at all. It says
              what the calendar half covers, because a year *is* a horizon and
              pretending otherwise would make an empty agenda look like an
              empty diary. */}
          <p className="muted mt-1 text-base md:mt-0.5 md:text-xs">
            {range === 'today'
              ? formatLongDate(today)
              : range === 'all'
                ? 'Everything still open, and the year ahead'
                : `${formatLongDate(today)} – ${formatLongDate(days[days.length - 1]!)}`}
          </p>
        </div>
        <SearchButton />
      </header>

      <div className="flex items-center gap-2 px-5 pb-4">
        <RangeSwitch current={range} />
      </div>

      {/* No card. A stat that needs a box around it is a stat nobody trusted. */}
      <div
        className="hairline flex flex-wrap items-baseline gap-x-9 gap-y-2 border-b px-5 pb-5 md:pb-3 md:pt-3"
        style={{ background: 'var(--bg)' }}
      >
        <Stat n={counts.events} label={counts.events === 1 ? 'event' : 'events'} />
        {range === 'all' ? (
          <Stat n={counts.open} label={counts.open === 1 ? 'task open' : 'tasks open'} />
        ) : (
          <Stat n={counts.tasks} label={counts.tasks === 1 ? 'task due' : 'tasks due'} />
        )}
        {/* The only coloured stat. Overdue is a state worth naming in --danger;
            nothing else on this strip is. */}
        <Stat n={counts.overdue} label="overdue" danger={counts.overdue > 0} />
        {yesterday.eventCount > 0 && yesterday.noteCount === 0 && (
          <span className="faint ml-auto flex items-center gap-1.5 self-center text-xs">
            <Icon name="calendar" size={12} />
            {plural(yesterday.eventCount, 'event')} yesterday, no notes.
          </span>
        )}
      </div>

      {/* Desktop only. On a phone the capture button is the way in — a
          second always-open field a row below the stats was the same action
          twice, and it pushed "What's on" off the first screen. */}
      <div className="hidden md:block">
        <ComposeTask spaces={spaces} categories={categories} />
      </div>

      <SectionHeading>What’s on</SectionHeading>
      <Agenda items={items} days={days} today={today} labelDays={range !== 'today'} />

      {reviews.length > 0 && (
        <section className="hairline border-b px-5 py-3" aria-labelledby="week-review-heading">
          <h2 id="week-review-heading" className="section-label mb-2 flex items-center gap-1.5">
            <Icon name="sparkle" size={11} />
            Review the week ahead
          </h2>
          <ul className="flex flex-wrap items-center gap-2" id="week-review">
            {reviews.map((c) => (
              <li key={c.id}>
                <form action={runAiFeatureFor} className="flex items-center gap-1.5">
                  <input type="hidden" name="feature" value="weekly_review" />
                  <input type="hidden" name="subjectId" value={c.spaceId} />
                  <input type="hidden" name="back" value="today" />
                  <SpaceIndicator space={c.space} />
                  <button
                    type="submit"
                    className="hairline rounded border px-2.5 py-1.5 text-xs"
                    aria-label={`Review the week ahead in ${c.space.name}`}
                  >
                    {c.isEnabled ? 'Review it' : 'Review it (switched off)'}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="faint mt-1.5 text-xs">
            Titles and dates for the next seven days. No note bodies, nothing
            locked, and one space at a time.
          </p>
          <div className="mt-2">
            <AiResult sent={sent} answer={answer} refused={refused} />
          </div>
        </section>
      )}

      {dates.length > 0 && (
        <section>
          <SectionHeading>Coming up</SectionHeading>
          <ul>
            {dates.map((d) => (
              <li key={`${d.personId}-${d.kind}-${d.onDate}`} className="hairline border-b">
                {/* Two lines, not one wrapping row. The name is what the eye is
                    hunting for and it now has a line to itself; what kind of
                    date it is sits under it, and how far away it is stays
                    right-aligned where a column of them can be read down. */}
                <Link
                  href={`/people/${d.personId}`}
                  className="row-hover flex min-h-[52px] items-center gap-2.5 px-5 py-2.5"
                >
                  <Icon name="cake" size={15} className="faint shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{d.displayName}</span>
                    <span className="muted block truncate text-sm">
                      {d.label ?? d.kind}
                      {d.turning != null && d.kind === 'birthday'
                        ? ` — turning ${d.turning}`
                        : ''}
                    </span>
                  </span>
                  <span className="faint shrink-0 text-sm">
                    {d.daysAway === 0
                      ? 'today'
                      : d.daysAway === 1
                        ? 'tomorrow'
                        : `in ${plural(d.daysAway, 'day')}`}
                  </span>
                  <SpaceIndicator space={d.space} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dueToday.length > 0 && (
        <section>
          <SectionHeading>Due today</SectionHeading>
          <ul>
            {dueToday.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      )}

      {overdue.length > 0 && (
        <section>
          <SectionHeading>
            Overdue
            {overdue.length > 10 && (
              <Link href="/tasks/overdue" className="faint ml-2 font-normal">
                see all {overdue.length}
              </Link>
            )}
          </SectionHeading>
          <ul>
            {overdue.slice(0, 10).map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      )}

      {/* All only. This is the section the range exists for: a task with no
          date is in none of the three windows above, so until now the home page
          had no way to show one. Capped at 50 with a way through to the full
          list, the same shape Overdue already uses. */}
      {range === 'all' && restOpen.length > 0 && (
        <section>
          <SectionHeading>
            Open
            {restOpen.length > 50 && (
              <Link href="/tasks/all" className="faint ml-2 font-normal">
                see all {restOpen.length}
              </Link>
            )}
          </SectionHeading>
          <ul>
            {restOpen.slice(0, 50).map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      )}

      {spaces.length === 0 ? (
        <div className="muted px-5 py-10 text-sm">
          <p className="mb-1">You are not a member of any space.</p>
          <p className="faint text-xs">
            Nothing is hidden from you here — there is genuinely nothing to show. Spaces
            are the unit of sharing in Orbit, and membership is the only way in.
          </p>
        </div>
      ) : (
        dueNow.length === 0 &&
        items.length === 0 &&
        restOpen.length === 0 && (
          <p className="faint px-5 py-10 text-sm">
            {range === 'all' ? 'Nothing open at all. That is allowed.' : 'Nothing due. That is allowed.'}
          </p>
        )
      )}
    </div>
  );
}

function Stat({ n, label, danger = false }: { n: number; label: string; danger?: boolean }) {
  return (
    <div className="stat" style={danger ? { color: 'var(--danger)' } : undefined}>
      <span className="stat-num">{n}</span>
      {/* `.section-label` is the 12px uppercase label; the danger variant has
          to restate it rather than compose, because the colour comes from the
          wrapper and `.section-label` sets its own. */}
      <span
        className={
          danger ? 'text-xs font-medium uppercase tracking-[0.08em]' : 'section-label'
        }
      >
        {label}
      </span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="hairline section-label border-y px-5 py-2.5"
      style={{ background: 'var(--bg-sunken)' }}
    >
      {children}
    </h2>
  );
}
