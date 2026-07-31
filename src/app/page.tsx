import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { categoriesBySpace, listTasks } from '@/lib/queries/tasks';
import { yesterdaySummary } from '@/lib/queries/notes';
import { upcomingDates } from '@/lib/queries/people';
import { TaskRow } from '@/components/TaskRow';
import { ComposeTask } from '@/components/ComposeTask';
import { Icon } from '@/components/Icon';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { plural } from '@/lib/format';
import { AiResult } from '@/components/AiResult';
import { listConsents } from '@/lib/queries/ai';
import { runAiFeatureFor } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; answer?: string; refused?: string }>;
}) {
  const { sent, answer, refused } = await searchParams;
  const user = await requireUser();
  const [spaces, categories, today, overdue, yesterday, dates, consents] = await Promise.all([
    listSpaces(user.id),
    categoriesBySpace(user.id),
    listTasks(user.id, 'today', { limit: 50 }),
    listTasks(user.id, 'overdue', { limit: 50 }),
    yesterdaySummary(user.id),
    upcomingDates(user.id, 21),
    listConsents(user.id),
  ]);

  // Consent is per feature *and* per space, so a weekly review is offered once
  // per space rather than once. There is no "all my spaces" version: a review
  // that read three spaces on one consent would be the consent meaning more
  // than it said.
  const reviews = consents.filter((c) => c.feature === 'weekly_review');

  const overdueOnly = overdue.filter((t) => !today.some((x) => x.id === t.id));
  const firstName = user.displayName.split(' ')[0];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <h1 className="text-lg font-semibold">Today</h1>
        <p className="muted mt-0.5 text-xs">
          Good morning, {firstName}. {plural(today.length, 'task')} due.
        </p>
      </header>

      <ComposeTask spaces={spaces} categories={categories} />

      {/*
        The whole post-event feature (decision 10). A quiet row, stated once,
        with no prompt, no badge, and nothing to dismiss. If there is nothing to
        say, it does not appear at all.
      */}
      {yesterday.eventCount > 0 && yesterday.noteCount === 0 && (
        <div className="hairline muted flex items-center gap-2 border-b px-5 py-2 text-xs">
          <Icon name="calendar" size={12} className="faint" />
          {plural(yesterday.eventCount, 'event')} yesterday, no notes.
        </div>
      )}

      {reviews.length > 0 && (
        <section className="hairline border-b px-5 py-3" aria-labelledby="week-review-heading">
          <h2
            id="week-review-heading"
            className="faint mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider"
          >
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

      {today.length > 0 && (
        <section>
          <SectionHeading>Due today</SectionHeading>
          <ul>
            {today.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      )}

      {overdueOnly.length > 0 && (
        <section>
          <SectionHeading>
            Overdue
            <Link href="/tasks/overdue" className="faint ml-2 font-normal">
              see all
            </Link>
          </SectionHeading>
          <ul>
            {overdueOnly.slice(0, 10).map((t) => (
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
        today.length === 0 &&
        overdueOnly.length === 0 && (
          <p className="faint px-5 py-10 text-sm">Nothing due. That is allowed.</p>
        )
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="hairline faint border-b px-5 py-1.5 text-2xs font-semibold uppercase tracking-wider"
      style={{ background: 'var(--bg-sunken)' }}
    >
      {children}
    </h2>
  );
}
