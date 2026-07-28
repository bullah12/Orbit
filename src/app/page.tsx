import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSpaces } from '@/lib/queries/spaces';
import { categoriesBySpace, listTasks } from '@/lib/queries/tasks';
import { yesterdaySummary } from '@/lib/queries/notes';
import { TaskRow } from '@/components/TaskRow';
import { ComposeTask } from '@/components/ComposeTask';
import { Icon } from '@/components/Icon';
import { plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const user = await requireUser();
  const [spaces, categories, today, overdue, yesterday] = await Promise.all([
    listSpaces(user.id),
    categoriesBySpace(user.id),
    listTasks(user.id, 'today', { limit: 50 }),
    listTasks(user.id, 'overdue', { limit: 50 }),
    yesterdaySummary(user.id),
  ]);

  const overdueOnly = overdue.filter((t) => !today.some((x) => x.id === t.id));
  const firstName = user.displayName.split(' ')[0];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="hairline border-b px-5 py-4">
        <h1 className="text-[15px] font-semibold">Today</h1>
        <p className="muted mt-0.5 text-[12px]">
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
        <div className="hairline muted flex items-center gap-2 border-b px-5 py-2 text-[12px]">
          <Icon name="calendar" size={12} className="faint" />
          {plural(yesterday.eventCount, 'event')} yesterday, no notes.
        </div>
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

      {today.length === 0 && overdueOnly.length === 0 && (
        <p className="faint px-5 py-10 text-[13px]">Nothing due. That is allowed.</p>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="hairline faint border-b px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: 'var(--bg-sunken)' }}
    >
      {children}
    </h2>
  );
}
