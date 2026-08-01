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
import {
  addDaysISO,
  formatDate,
  formatLongDate,
  londonMidnight,
  plural,
  todayISO,
  type DateOnly,
} from '@/lib/format';
import { AiResult } from '@/components/AiResult';
import { listConsents } from '@/lib/queries/ai';
import { runAiFeatureFor } from '@/app/actions';

export const dynamic = 'force-dynamic';

/** How many days each range covers, starting today. Month is a rolling 30. */
const SPAN: Record<Range, number> = { today: 1, week: 7, month: 30 };

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; answer?: string; refused?: string; range?: string }>;
}) {
  const { sent, answer, refused, range: rawRange } = await searchParams;
  const range: Range = isRange(rawRange) ? rawRange : 'today';

  const user = await requireUser();
  const today = todayISO();
  const days: DateOnly[] = Array.from({ length: SPAN[range] }, (_, i) => addDaysISO(today, i));

  const [spaces, categories, dueNow, overdue, items, yesterday, dates, consents] =
    await Promise.all([
      listSpaces(user.id),
      categoriesBySpace(user.id),
      listTasks(user.id, 'today', { limit: 100 }),
      listTasks(user.id, 'overdue', { limit: 100 }),
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

  // Every number in the strip is the length of a list this page renders, which
  // is the whole reason for counting here rather than asking the database
  // separately: a summary that disagrees with what is underneath it is worse
  // than no summary, and this one cannot.
  const counts = {
    events: items.length,
    tasks: dueToday.length,
    overdue: overdue.length,
  };

  return (
    <div className="measure flex min-h-screen flex-col">
      {/* The header must wrap: the switch is `flex-none` and nowrap because
          squeezed it clipped "Month" to "Mont". */}
      <header className="hairline flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b px-5 py-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {range === 'today' ? 'Today' : range === 'week' ? 'This week' : 'This month'}
          </h1>
          {/* Spelled out rather than 01/08/2026. A page title is read, not
              scanned down a column, and a numeric date at the top of the app is
              the one place the DD/MM–MM/DD ambiguity actually costs something. */}
          <p className="muted mt-0.5 text-xs">
            {range === 'today'
              ? formatLongDate(today)
              : `${formatLongDate(today)} – ${formatLongDate(days[days.length - 1]!)}`}
          </p>
        </div>
        <div className="ml-auto">
          <RangeSwitch current={range} />
        </div>
      </header>

      {/* No card. A stat that needs a box around it is a stat nobody trusted. */}
      <div
        className="hairline flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b px-5 py-3"
        style={{ background: 'var(--bg)' }}
      >
        <Stat n={counts.events} label={counts.events === 1 ? 'event' : 'events'} />
        <Stat n={counts.tasks} label={counts.tasks === 1 ? 'task due' : 'tasks due'} />
        {/* The only coloured stat. Overdue is a state worth naming in --danger;
            nothing else on this strip is. */}
        <Stat n={counts.overdue} label="overdue" danger={counts.overdue > 0} />
        {yesterday.eventCount > 0 && yesterday.noteCount === 0 && (
          <span className="faint ml-auto flex items-center gap-1.5 self-center text-2xs">
            <Icon name="calendar" size={11} />
            {plural(yesterday.eventCount, 'event')} yesterday, no notes.
          </span>
        )}
      </div>

      <ComposeTask spaces={spaces} categories={categories} />

      <SectionHeading>What’s on</SectionHeading>
      <Agenda items={items} days={days} today={today} />

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
                    className="hairline rounded border px-2 py-0.5 text-2xs"
                    aria-label={`Review the week ahead in ${c.space.name}`}
                  >
                    {c.isEnabled ? 'Review it' : 'Review it (switched off)'}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="faint mt-1.5 text-2xs">
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
              <li
                key={`${d.personId}-${d.kind}-${d.onDate}`}
                className="hairline row-hover flex flex-wrap items-baseline gap-2 border-b px-5 py-1.5 text-sm"
              >
                <Icon name="cake" size={12} className="faint shrink-0" />
                <Link href={`/people/${d.personId}`} className="min-w-0 truncate">
                  {d.displayName}
                </Link>
                <span className="muted text-xs">
                  {d.label ?? d.kind}
                  {d.turning != null && d.kind === 'birthday' ? ` — turning ${d.turning}` : ''}
                </span>
                <span className="faint ml-auto shrink-0 text-2xs">
                  {d.daysAway === 0
                    ? 'today'
                    : d.daysAway === 1
                      ? 'tomorrow'
                      : `in ${plural(d.daysAway, 'day')}`}
                </span>
                <SpaceIndicator space={d.space} />
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
        items.length === 0 && (
          <p className="faint px-5 py-10 text-sm">Nothing due. That is allowed.</p>
        )
      )}
    </div>
  );
}

function Stat({ n, label, danger = false }: { n: number; label: string; danger?: boolean }) {
  return (
    <div className="stat" style={danger ? { color: 'var(--danger)' } : undefined}>
      <span className="stat-num">{n}</span>
      <span className={danger ? 'text-2xs uppercase tracking-wider' : 'section-label'}>
        {label}
      </span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="hairline section-label border-b px-5 py-1.5"
      style={{ background: 'var(--bg-sunken)' }}
    >
      {children}
    </h2>
  );
}
