import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { normaliseRange, summary, type Range, type SummaryEvent } from '@/lib/queries/summary';
import { RangeSwitch } from '@/components/RangeSwitch';
import { DueRow } from '@/components/DueRow';
import { SpaceIndicator } from '@/components/SpaceIndicator';
import { ComposeTask } from '@/components/ComposeTask';
import { AiResult } from '@/components/AiResult';
import { Icon } from '@/components/Icon';
import { runAiFeatureFor } from '@/app/actions';
import {
  formatTime,
  plural,
  londonDayISO,
  londonTimeHHMM,
  minutesIntoLondonDay,
  todayISO,
  type DateOnly,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Now — the page that answers a question.
 *
 * The calendar is where you *place* things; you arrive at it already knowing
 * the date. Now is where you ask what needs doing, and Today / Week / Month is
 * that same question at three grains. One query, one payload: the number in the
 * summary strip and the list underneath it are the same data, so they cannot
 * disagree.
 */
export default async function NowPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; sent?: string; answer?: string; refused?: string }>;
}) {
  const { range: rawRange, sent, answer, refused } = await searchParams;
  const range = normaliseRange(rawRange);
  const user = await requireUser();

  // One request. Not one per widget.
  const data = await summary(user.id, range);

  const today = todayISO();
  const now = new Date();
  const nowMinutes = minutesIntoLondonDay(now);
  const groups = groupEvents(data.events, range, data.from, data.to);

  return (
    <div className="mx-auto w-full max-w-[46rem] px-3 py-4">
      <div className="surface overflow-hidden">
        {/*
          The header wraps rather than compressing: the range switch is ~162px
          intrinsic and squeezing it clips "Month" to "Mont".
        */}
        <header className="hairline flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-2.5 py-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ letterSpacing: '-0.01em' }}>
              {weekdayLabel(range, today)}
            </h1>
            <p className="muted tabular text-xs">{rangeLabel(range, data.from, data.to)}</p>
          </div>
          <div className="ml-auto">
            <RangeSwitch range={range} />
          </div>
        </header>

        {/*
          No card around a stat. A number that needs a box drawn round it is a
          number nobody trusted.
        */}
        <div
          className="hairline flex flex-wrap gap-x-5 gap-y-2 border-b px-2.5 py-2.5"
          style={{ background: 'var(--bg)' }}
        >
          <Stat n={data.counts.events} label="events" />
          <Stat n={data.counts.tasks} label="tasks" />
          <Stat n={data.counts.overdue} label="overdue" danger />

          {data.perPerson.length > 0 && (
            <div className="muted ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 self-end text-xs">
              {data.perPerson.slice(0, 3).map((p) => (
                <span key={p.personId} className="flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: `var(--c-${p.colour}, var(--c-slate))` }}
                  />
                  {p.name} has {p.count}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* --- agenda --------------------------------------------------- */}
        {data.events.length === 0 ? (
          <p className="faint px-2.5 py-8 text-sm">Nothing scheduled. That is allowed.</p>
        ) : (
          <div className="flex flex-col gap-1.5 px-2.5 py-2.5">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label ?? undefined}>
                {group.label && <h2 className="section-label mb-1.5 mt-1">{group.label}</h2>}
                <div className="flex flex-col gap-1.5">
                  {group.events.map((event, i) => (
                    <div key={event.key}>
                      {/*
                        The now-line appears once, in the gap the current time
                        actually falls in. It is the only bare accent hairline
                        in the app: not interactive, and it means exactly one
                        thing.
                      */}
                      {group.isToday && showNowLineBefore(group.events, i, nowMinutes) && (
                        <NowLine at={londonTimeHHMM(now)} />
                      )}
                      <AgendaBlock event={event} isNow={group.isToday && containsNow(event, nowMinutes)} />
                    </div>
                  ))}
                  {group.isToday && showNowLineBefore(group.events, group.events.length, nowMinutes) && (
                    <NowLine at={londonTimeHHMM(now)} />
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* --- due list ------------------------------------------------- */}
        {data.due.length > 0 && (
          <section className="hairline border-t" aria-labelledby="due-heading">
            <h2 id="due-heading" className="section-label px-2.5 pb-1 pt-2.5">
              {range === 'today' ? 'Due today' : range === 'week' ? 'Due this week' : 'Due this month'}
            </h2>
            <ul>
              {data.due.map((item) => (
                <DueRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        )}
      </div>

      {/*
        Below the surface: the things Now inherited from the page it replaced.
        The four regions above are what the range switch governs; these are
        constant, so they sit outside it rather than pretending to be part of
        the answer. All of it came from the same one payload.
      */}

      <ComposeTask spaces={data.spaces} categories={data.categories} />

      {/* The whole post-event feature: a quiet row, stated once, with no
          prompt, no badge and nothing to dismiss. */}
      {data.yesterday.eventCount > 0 && data.yesterday.noteCount === 0 && (
        <p className="muted mt-3 flex items-center gap-2 text-xs">
          <Icon name="calendar" size={12} className="faint" />
          {plural(data.yesterday.eventCount, 'event')} yesterday, no notes.
        </p>
      )}

      {data.reviews.length > 0 && (
        <section className="surface mt-3 p-2.5" aria-labelledby="week-review-heading">
          <h2 id="week-review-heading" className="section-label mb-1.5 flex items-center gap-1.5">
            <Icon name="sparkle" size={11} />
            Review the week ahead
          </h2>
          <ul className="flex flex-wrap items-center gap-2" id="week-review">
            {data.reviews.map((c) => (
              <li key={c.id}>
                <form action={runAiFeatureFor} className="flex items-center gap-1.5">
                  <input type="hidden" name="feature" value="weekly_review" />
                  <input type="hidden" name="subjectId" value={c.spaceId} />
                  <input type="hidden" name="back" value="today" />
                  <SpaceIndicator space={c.space} />
                  <button
                    type="submit"
                    className="hairline rounded-md border px-2 py-0.5 text-2xs"
                    aria-label={`Review the week ahead in ${c.space.name}`}
                  >
                    {c.isEnabled ? 'Review it' : 'Review it (switched off)'}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="faint mt-1.5 text-2xs">
            Titles and dates for the next seven days. No note bodies, nothing locked, and
            one space at a time.
          </p>
          <div className="mt-2">
            <AiResult sent={sent} answer={answer} refused={refused} />
          </div>
        </section>
      )}

      {data.upcoming.length > 0 && (
        <section className="surface mt-3 overflow-hidden" aria-labelledby="coming-up-heading">
          <h2 id="coming-up-heading" className="section-label px-2.5 pb-1 pt-2.5">
            Coming up
          </h2>
          <ul>
            {data.upcoming.map((d) => (
              <li key={`${d.personId}-${d.kind}-${d.onDate}`} className="row row-hover">
                <Icon name="cake" size={12} className="faint shrink-0" />
                <Link href={`/people/${d.personId}`} className="min-w-0 truncate text-sm">
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

      {data.spaces.length === 0 && (
        <div className="muted px-2.5 py-10 text-sm">
          <p className="mb-1">You are not a member of any space.</p>
          <p className="faint text-xs">
            Nothing is hidden from you here — there is genuinely nothing to show. Spaces
            are the unit of sharing in Orbit, and membership is the only way in.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, danger = false }: { n: number; label: string; danger?: boolean }) {
  // Overdue is the only coloured stat, and it colours the number *and* the
  // label so the meaning does not depend on reading the small word alone.
  const colour = danger && n > 0 ? { color: 'var(--danger)' } : undefined;
  return (
    <div className="stat">
      <span className="stat-num" style={colour}>
        {n}
      </span>
      <span className="section-label" style={colour}>
        {label}
      </span>
    </div>
  );
}

function NowLine({ at }: { at: string }) {
  return (
    <div className="relative my-1.5 ml-[var(--gutter)]">
      <div className="now-line" role="presentation" />
      <span
        className="tabular absolute -top-2 right-0 pl-1 text-2xs font-medium"
        style={{ color: 'var(--accent)', background: 'var(--bg-raised)' }}
      >
        now {at}
      </span>
    </div>
  );
}

function AgendaBlock({ event, isNow }: { event: SummaryEvent; isNow: boolean }) {
  const time = event.allDay ? 'all day' : formatTime(event.startsAt);

  return (
    <div className="flex items-start gap-0">
      {/*
        A fixed gutter, shared with the calendar's, so a 24-hour time reads
        down one straight line whichever page you are on. The padding aligns
        the time to the title's baseline rather than the block's top edge.
      */}
      <span className="block-time w-[var(--gutter)] shrink-0 pt-[0.5625rem] tabular">{time}</span>

      {event.anonymous ? (
        // Somebody else's time. Quieter by shape, and it spends none of the ten
        // category colours saying so.
        <div className="busy min-w-0 flex-1 px-2.5 py-2">
          <span className="[display:block] truncate text-base">Busy</span>
          <span className="block-time">{event.spaceName}</span>
        </div>
      ) : (
        <div
          className={`block min-w-0 flex-1${isNow ? ' block-now' : ''}`}
          // The category colour lives on the left edge only. Filling the block
          // turns a stack of them into a colour chart.
          style={isNow ? undefined : { borderLeftColor: `var(--c-${event.categoryColour}, var(--c-slate))` }}
        >
          <span className="truncate text-base">{event.title}</span>
          <span className="muted tabular flex flex-wrap items-center gap-x-1.5 text-xs">
            {event.endsAt && !event.allDay && <span>{duration(event.startsAt, event.endsAt)}</span>}
            {event.note && <span>· {event.note}</span>}
            <SpaceIndicator space={event.space} />
          </span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type Group = {
  key: string;
  label: string | null;
  isToday: boolean;
  events: SummaryEvent[];
};

/**
 * The range does not change the shape of the page, only how the agenda is
 * grouped: today is one ungrouped list, a week groups per day, a month per
 * week. Same blocks, same gutter, same order.
 */
function groupEvents(events: SummaryEvent[], range: Range, from: DateOnly, to: DateOnly): Group[] {
  const today = todayISO();
  if (range === 'today') {
    return [{ key: from, label: null, isToday: from === today, events }];
  }

  const buckets = new Map<string, SummaryEvent[]>();
  for (const event of events) {
    const day = londonDayISO(event.startsAt);
    const key = range === 'week' ? day : weekKey(day);
    const list = buckets.get(key);
    if (list) list.push(event);
    else buckets.set(key, [event]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({
      key,
      label: range === 'week' ? dayLabel(key) : weekLabel(key),
      isToday: range === 'week' ? key === today : key === weekKey(today),
      events: list,
    }));

  function weekKey(day: DateOnly): DateOnly {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function weekLabel(key: DateOnly): string {
    const end = new Date(`${key}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const endIso = end.toISOString().slice(0, 10);
    return `${shortDate(key)} – ${shortDate(endIso > to ? to : endIso)}`;
  }
}

function containsNow(event: SummaryEvent, nowMinutes: number): boolean {
  if (event.allDay) return false;
  if (londonDayISO(event.startsAt) !== todayISO()) return false;
  const start = minutesIntoLondonDay(event.startsAt);
  const end = event.endsAt ? minutesIntoLondonDay(event.endsAt) : start + 30;
  return nowMinutes >= start && nowMinutes < end;
}

/**
 * The now-line goes in the first gap the current time falls into, and only if
 * no block already contains it — a block that is happening now says so with
 * `.block-now`, and two markers for one fact is one too many.
 */
function showNowLineBefore(events: SummaryEvent[], index: number, nowMinutes: number): boolean {
  const today = todayISO();
  const timed = events.filter((e) => !e.allDay && londonDayISO(e.startsAt) === today);
  if (timed.length === 0) return false;
  if (timed.some((e) => containsNow(e, nowMinutes))) return false;

  const before = events.slice(0, index).filter((e) => !e.allDay);
  const after = events.slice(index).filter((e) => !e.allDay);
  const lastBefore = before.at(-1);
  const firstAfter = after[0];

  const startedBefore = lastBefore == null || minutesIntoLondonDay(lastBefore.startsAt) <= nowMinutes;
  const startsAfter = firstAfter == null || minutesIntoLondonDay(firstAfter.startsAt) > nowMinutes;
  return startedBefore && startsAfter;
}

function duration(startsAt: string, endsAt: string): string {
  const mins = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = mins / 60;
  return hours === 1 ? '1 hr' : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
}

function weekdayLabel(range: Range, today: DateOnly): string {
  if (range === 'today') {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(
      new Date(`${today}T00:00:00Z`),
    );
  }
  return range === 'week' ? 'This week' : 'This month';
}

function rangeLabel(range: Range, from: DateOnly, to: DateOnly): string {
  if (range === 'today') return longDate(from);
  return `${shortDate(from)} – ${shortDate(to)}`;
}

function dayLabel(iso: DateOnly): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short',
  }).format(new Date(`${iso}T00:00:00Z`));
}

function longDate(iso: DateOnly): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'long',
  }).format(new Date(`${iso}T00:00:00Z`));
}

function shortDate(iso: DateOnly): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short',
  }).format(new Date(`${iso}T00:00:00Z`));
}
