/**
 * Natural-language capture. **Local only. Nothing here touches the network.**
 *
 * Decision 8 and ADR section 7: capture parsing is local-only and must never
 * touch the network. That is a promise about this directory, so this file
 * imports exactly one thing — the date helpers in src/lib/format.ts — and
 * `tests/capture.test.ts` reads this source back and fails if a `fetch`, an
 * `import()` or a node network module ever appears in it. The ADR calls for a
 * lint rule; linting is out of scope by instruction, so the test is the rule.
 *
 * It is also not AI. There is no model here and no call to `AiProvider`: one
 * typed line goes in, a structured draft comes out, and every span the parser
 * consumed comes back with it so the compose surface can *show its working*.
 * That is the same bargain the rules engine's dry run makes — nothing is
 * created off an interpretation somebody has not been shown.
 *
 * Everything is UK: DD/MM, 24-hour output, Monday-first weeks, "half three"
 * meaning half past three, and every instant resolved through
 * `londonInstant()` so a 09:00 in January and a 09:00 in July are both 09:00
 * on the clock in the room.
 */

import {
  addDaysISO,
  londonInstant,
  startOfWeekISO,
  todayISO,
  weekdayOf,
  type DateOnly,
} from '@/lib/format';

export type CaptureKind = 'task' | 'note' | 'event';

export type CapturePriority = 'none' | 'low' | 'normal' | 'high' | 'urgent';

/** What the parser consumed, and why. Shown back to the person who typed it. */
export type CaptureMatch = {
  field: 'kind' | 'date' | 'time' | 'duration' | 'priority' | 'space' | 'assignee';
  /** The words taken out of the title. */
  text: string;
  /** Plain English: "Friday 31 July", "15:30 — afternoon assumed". */
  meaning: string;
};

export type Capture = {
  kind: CaptureKind;
  /** What is left after every recognised phrase is taken out. */
  title: string;
  /** London calendar date, or null. */
  date: DateOnly | null;
  /** London wall clock 'HH:MM', or null for an all-day / undated thing. */
  time: string | null;
  /** Only ever set alongside `time`. */
  endTime: string | null;
  priority: CapturePriority | null;
  /** The word after `#`, lower-cased. Resolved against real spaces by the caller. */
  spaceHint: string | null;
  /** The word after `@`, lower-cased. Resolved against real members by the caller. */
  assigneeHint: string | null;
  matches: CaptureMatch[];
};

export type CaptureClock = {
  /** London calendar date "now". */
  today: DateOnly;
};

// ---------------------------------------------------------------------------
// Weekdays and months
// ---------------------------------------------------------------------------

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_WORDS = Object.keys(WEEKDAYS).join('|');
const MONTH_WORDS = Object.keys(MONTHS).join('|');

const SMALL_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const CLOCK_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const CLOCK_WORDS_RE = Object.keys(CLOCK_WORDS).join('|');

/**
 * The next occurrence of a weekday, strictly after `from`.
 *
 * Strictly: "on Tuesday", typed on a Tuesday, means the Tuesday coming, not
 * this afternoon. Somebody who meant today would have typed today.
 */
function nextWeekday(from: DateOnly, target: number): DateOnly {
  const ahead = ((target - weekdayOf(from) + 7) % 7) || 7;
  return addDaysISO(from, ahead);
}

/** That weekday, in the Monday-first week after the current one. */
function weekdayNextWeek(from: DateOnly, target: number): DateOnly {
  const nextMonday = addDaysISO(startOfWeekISO(from), 7);
  return addDaysISO(nextMonday, (target + 6) % 7);
}

/** "Friday 31 July", for the chip that shows what a phrase resolved to. */
export function describeDate(iso: DateOnly): string {
  const day = Number(iso.slice(8, 10));
  const month = Number(iso.slice(5, 7));
  return `${WEEKDAY_NAMES[weekdayOf(iso)]} ${day} ${MONTH_NAMES[month]}`;
}

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

const GAP = '\u0000';

/**
 * The input, with the consumed spans blanked out.
 *
 * Every pattern below is anchored on word boundaries and cannot cross a blank,
 * so "next Friday at half three" cannot have its "three" read again as a date
 * once the time matcher has taken it.
 */
class Scanner {
  private masked: string;
  readonly matches: CaptureMatch[] = [];

  constructor(readonly raw: string) {
    this.masked = raw;
  }

  /** The first match of `re` in what is left, or null. */
  find(re: RegExp): RegExpExecArray | null {
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    rx.lastIndex = 0;
    for (;;) {
      const m = rx.exec(this.masked);
      if (!m) return null;
      if (!m[0].includes(GAP)) return m;
      rx.lastIndex = m.index + 1;
    }
  }

  consume(m: RegExpExecArray, field: CaptureMatch['field'], meaning: string): void {
    this.masked =
      this.masked.slice(0, m.index) +
      GAP.repeat(m[0].length) +
      this.masked.slice(m.index + m[0].length);
    this.matches.push({ field, text: m[0].trim(), meaning });
  }

  /**
   * What is left, as a title.
   *
   * Connecting words orphaned by a phrase being taken out ("call Mum on" once
   * "Friday" has gone) are dropped from the ends, because a title ending in
   * "on" reads as a mistake the parser made — which it is.
   */
  title(): string {
    let t = this.masked
      .split(GAP)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    for (;;) {
      const next = t
        .replace(/^(on|at|by|for|to|and|,)\b\s*/i, '')
        .replace(/\s*\b(on|at|by|for|to|and)$/i, '')
        .replace(/\s*,\s*$/, '')
        .trim();
      if (next === t) break;
      t = next;
    }
    return t;
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * A bare hour, resolved.
 *
 * There is no right answer to "at 7", so there is a *stated* one: 1–6 is the
 * afternoon, 7–11 is the morning, 12 is midday. That is what makes "half
 * three" mean half past three, which is the only thing it can mean in English.
 * The assumption is written into the match's meaning, so the chip on the screen
 * says "07:00 — morning assumed" and can be argued with before anything is
 * created.
 */
function resolveHour(hour: number, meridiem: string | null): { hour: number; assumed: boolean } {
  const m = meridiem?.toLowerCase().replace(/[.\s]/g, '') ?? null;
  if (m === 'pm') return { hour: hour === 12 ? 12 : hour + 12, assumed: false };
  if (m === 'am') return { hour: hour === 12 ? 0 : hour, assumed: false };
  if (hour >= 13) return { hour, assumed: false };
  if (hour === 12) return { hour: 12, assumed: false };
  if (hour === 0) return { hour: 0, assumed: false };
  if (hour <= 6) return { hour: hour + 12, assumed: true };
  return { hour, assumed: true };
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeMeaning(time: string, assumed: boolean): string {
  if (!assumed) return time;
  const hour = Number(time.slice(0, 2));
  return `${time} — ${hour < 12 ? 'morning' : 'afternoon'} assumed`;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

const KIND_WORDS = /^\s*(note|task|event|meeting|reminder)\s*:\s*/i;
const EVENT_WORDS =
  /\b(meeting|appointment|lunch|dinner|breakfast|drinks|coffee|call with|standup|stand-up|party|birthday party|interview)\b/i;

/**
 * Parse one typed line.
 *
 * The order of the matchers is the whole design: the longest, most specific
 * phrase is taken first, and every span it takes is blanked out so a later,
 * greedier pattern cannot re-read a word that has already been spent. "a week
 * on Tuesday at half three" must not leave "three" behind for a date matcher.
 */
export function parseCapture(
  raw: string,
  clock: CaptureClock = { today: todayISO() },
): Capture {
  const s = new Scanner((raw ?? '').replace(/\s+/g, ' ').trim());
  const today = clock.today;

  let kind: CaptureKind | null = null;
  let date: DateOnly | null = null;
  let time: string | null = null;
  let endTime: string | null = null;
  let priority: CapturePriority | null = null;
  let spaceHint: string | null = null;
  let assigneeHint: string | null = null;

  // --- an explicit kind wins over everything ------------------------------
  {
    const m = s.find(KIND_WORDS);
    if (m) {
      const word = m[1].toLowerCase();
      kind = word === 'note' ? 'note' : word === 'task' || word === 'reminder' ? 'task' : 'event';
      s.consume(m, 'kind', `a ${kind}`);
    }
  }

  // --- markers ------------------------------------------------------------
  {
    const m = s.find(/#([a-z0-9][a-z0-9_-]*)/i);
    if (m) {
      spaceHint = m[1].toLowerCase();
      s.consume(m, 'space', `the space “${m[1]}”`);
    }
  }
  {
    const m = s.find(/@([a-z0-9][a-z0-9_-]*)/i);
    if (m) {
      assigneeHint = m[1].toLowerCase();
      s.consume(m, 'assignee', `assign to “${m[1]}”`);
    }
  }
  {
    const m = s.find(/!(urgent|high|normal|low|none)\b/i);
    if (m) {
      priority = m[1].toLowerCase() as CapturePriority;
      s.consume(m, 'priority', `${priority} priority`);
    } else {
      const bang = s.find(/(?:^|\s)(!!)(?=\s|$)/);
      if (bang) {
        priority = 'urgent';
        s.consume(bang, 'priority', 'urgent priority');
      }
    }
  }

  // --- duration -----------------------------------------------------------
  let durationMinutes: number | null = null;
  {
    const m = s.find(
      new RegExp(`\\bfor (\\d{1,3}|${Object.keys(SMALL_NUMBERS).join('|')}) ?(minutes|minute|mins|min|hours|hour|hrs|hr|h)\\b`, 'i'),
    );
    if (m) {
      const n = /^\d/.test(m[1]) ? Number(m[1]) : SMALL_NUMBERS[m[1].toLowerCase()];
      const isHours = /^h/i.test(m[2]);
      durationMinutes = isHours ? n * 60 : n;
      s.consume(m, 'duration', `${durationMinutes} minutes long`);
    }
  }

  // --- "tonight", "tomorrow morning" — a date and a time in one phrase -----
  //
  // This runs before either of the two matchers below, because whichever of
  // them saw it first would take half the phrase and leave the other half
  // stranded: "call mum this evening" would become a task on today with no
  // time, and the evening — the only part somebody typed on purpose — would be
  // gone.
  {
    const dayPart = matchDayPart(s, today);
    if (dayPart) {
      date = dayPart.date;
      time = dayPart.time;
    }
  }

  // --- dates, longest phrase first ----------------------------------------
  if (!date) date = matchDate(s, today);

  // --- times --------------------------------------------------------------
  if (!time) {
    const t = matchTime(s);
    if (t) time = t.time;
  }

  // A bare time with no date at all means today — that is what somebody typing
  // "at 7" on a Tuesday afternoon means.
  if (time && !date) date = today;

  if (time && durationMinutes) {
    const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const end = start + durationMinutes;
    // A duration that runs past midnight is clamped rather than rolling the
    // date over: an event that silently moved to tomorrow is worse than one
    // that ends at 23:59 and is obviously wrong.
    endTime = end >= 24 * 60 ? '23:59' : hhmm(Math.floor(end / 60), end % 60);
  }

  const title = s.title();

  if (!kind) {
    kind = time !== null && EVENT_WORDS.test(title) ? 'event' : 'task';
  }

  return {
    kind,
    title,
    date,
    time,
    endTime,
    priority,
    spaceHint,
    assigneeHint,
    matches: s.matches,
  };
}

/**
 * A day and a part of it, in one phrase.
 *
 * "tonight", "this evening", "tomorrow morning", "Friday afternoon". The
 * times are the conventional English ones and they are shown back on the chip,
 * so 09:00 for "morning" is a starting point somebody can argue with rather
 * than a claim about what they meant.
 */
const DAY_PART_TIME: Record<string, string> = {
  morning: '09:00',
  afternoon: '14:00',
  evening: '18:00',
  night: '21:00',
};

function matchDayPart(s: Scanner, today: DateOnly): { date: DateOnly; time: string } | null {
  {
    const m = s.find(/\btonight\b/i);
    if (m) {
      s.consume(m, 'time', `${describeDate(today)} at 19:00`);
      return { date: today, time: '19:00' };
    }
  }
  const m = s.find(
    new RegExp(
      `\\b(this|tomorrow|today|${WEEKDAY_WORDS}) (morning|afternoon|evening|night)\\b`,
      'i',
    ),
  );
  if (!m) return null;

  const which = m[1].toLowerCase();
  const date =
    which === 'tomorrow'
      ? addDaysISO(today, 1)
      : which === 'this' || which === 'today'
        ? today
        : nextWeekday(today, WEEKDAYS[which]);
  const time = DAY_PART_TIME[m[2].toLowerCase()];
  s.consume(m, 'time', `${describeDate(date)} at ${time}`);
  return { date, time };
}

function matchDate(s: Scanner, today: DateOnly): DateOnly | null {
  const take = (m: RegExpExecArray, iso: DateOnly): DateOnly => {
    s.consume(m, 'date', describeDate(iso));
    return iso;
  };

  // "a week on Tuesday" / "a week tomorrow" / "a fortnight on Friday"
  {
    const m = s.find(new RegExp(`\\ba (week|fortnight) (?:on |next )?(${WEEKDAY_WORDS})\\b`, 'i'));
    if (m) {
      const base = nextWeekday(today, WEEKDAYS[m[2].toLowerCase()]);
      return take(m, addDaysISO(base, m[1].toLowerCase() === 'fortnight' ? 14 : 7));
    }
  }
  {
    const m = s.find(/\ba (week|fortnight) (today|tomorrow)\b/i);
    if (m) {
      const base = m[2].toLowerCase() === 'tomorrow' ? addDaysISO(today, 1) : today;
      return take(m, addDaysISO(base, m[1].toLowerCase() === 'fortnight' ? 14 : 7));
    }
  }

  // "the day after tomorrow"
  {
    const m = s.find(/\b(?:the )?day after tomorrow\b/i);
    if (m) return take(m, addDaysISO(today, 2));
  }

  // "next Friday" — the Friday of next week, Monday-first.
  {
    const m = s.find(new RegExp(`\\bnext (${WEEKDAY_WORDS})\\b`, 'i'));
    if (m) return take(m, weekdayNextWeek(today, WEEKDAYS[m[1].toLowerCase()]));
  }

  // "this Friday" / "on Friday" / a bare "Friday" — the one coming.
  {
    const m = s.find(new RegExp(`\\b(?:this |on |next )?(${WEEKDAY_WORDS})\\b`, 'i'));
    if (m) return take(m, nextWeekday(today, WEEKDAYS[m[1].toLowerCase()]));
  }

  // "at the weekend" / "this weekend" — Saturday.
  {
    const m = s.find(/\b(?:at |this |next )?(?:the )?weekend\b/i);
    if (m) return take(m, nextWeekday(today, 6));
  }

  // "in 3 days" / "in a week" / "in two months"
  {
    const m = s.find(
      new RegExp(`\\bin (\\d{1,3}|${Object.keys(SMALL_NUMBERS).join('|')}) (days?|weeks?|months?)\\b`, 'i'),
    );
    if (m) {
      const n = /^\d/.test(m[1]) ? Number(m[1]) : SMALL_NUMBERS[m[1].toLowerCase()];
      const unit = m[2].toLowerCase();
      const iso = unit.startsWith('day')
        ? addDaysISO(today, n)
        : unit.startsWith('week')
          ? addDaysISO(today, n * 7)
          : addMonthsISO(today, n);
      return take(m, iso);
    }
  }

  // "next week" / "next month" — Monday of that week, first of that month.
  {
    const m = s.find(/\bnext (week|month)\b/i);
    if (m) {
      const iso =
        m[1].toLowerCase() === 'week'
          ? addDaysISO(startOfWeekISO(today), 7)
          : `${addMonthsISO(today, 1).slice(0, 8)}01`;
      return take(m, iso);
    }
  }

  // "5 August" / "5th of August" / "August 5th"
  {
    const m = s.find(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_WORDS})\\b`, 'i'));
    if (m) {
      const iso = onOrAfter(today, MONTHS[m[2].toLowerCase()], Number(m[1]));
      if (iso) return take(m, iso);
    }
  }
  {
    const m = s.find(new RegExp(`\\b(${MONTH_WORDS}) (\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'));
    if (m) {
      const iso = onOrAfter(today, MONTHS[m[1].toLowerCase()], Number(m[2]));
      if (iso) return take(m, iso);
    }
  }

  // DD/MM/YYYY, DD/MM/YY, DD/MM — UK order, always. Never MM/DD.
  {
    const m = s.find(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const year = m[3]
          ? Number(m[3].length === 2 ? `20${m[3]}` : m[3])
          : null;
        const iso = year
          ? validDate(year, month, day)
          : onOrAfter(today, month, day);
        if (iso) return take(m, iso);
      }
    }
  }

  // "the 5th" — this month if it is still to come, otherwise next.
  {
    const m = s.find(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/i);
    if (m) {
      const day = Number(m[1]);
      const iso = dayOnOrAfter(today, day);
      if (iso) return take(m, iso);
    }
  }

  // "tomorrow" / "today" / "tonight" / "this evening"
  {
    const m = s.find(/\btomorrow\b/i);
    if (m) return take(m, addDaysISO(today, 1));
  }
  {
    const m = s.find(/\b(today|tonight|this evening|this afternoon|this morning)\b/i);
    if (m) return take(m, today);
  }

  return null;
}

function matchTime(s: Scanner): { time: string; impliesToday: boolean } | null {
  const take = (m: RegExpExecArray, time: string, assumed: boolean, impliesToday = false) => {
    s.consume(m, 'time', timeMeaning(time, assumed));
    return { time, impliesToday };
  };

  // "half three", "half past three" — 15:30. Never 03:30.
  {
    const m = s.find(new RegExp(`\\b(?:at )?half(?: past)? (\\d{1,2}|${CLOCK_WORDS_RE}) ?(am|pm)?\\b`, 'i'));
    if (m) {
      const raw = /^\d/.test(m[1]) ? Number(m[1]) : CLOCK_WORDS[m[1].toLowerCase()];
      const { hour, assumed } = resolveHour(raw, m[2] ?? null);
      return take(m, hhmm(hour, 30), assumed);
    }
  }

  // "quarter past four", "quarter to five"
  {
    const m = s.find(
      new RegExp(`\\b(?:at )?(?:a )?quarter (past|to) (\\d{1,2}|${CLOCK_WORDS_RE}) ?(am|pm)?\\b`, 'i'),
    );
    if (m) {
      const raw = /^\d/.test(m[2]) ? Number(m[2]) : CLOCK_WORDS[m[2].toLowerCase()];
      const { hour, assumed } = resolveHour(raw, m[3] ?? null);
      const minutes = hour * 60 + (m[1].toLowerCase() === 'past' ? 15 : -15);
      const wrapped = (minutes + 24 * 60) % (24 * 60);
      return take(m, hhmm(Math.floor(wrapped / 60), wrapped % 60), assumed);
    }
  }

  // "midday" / "noon" / "midnight"
  {
    const m = s.find(/\b(midday|noon|midnight)\b/i);
    if (m) return take(m, m[1].toLowerCase() === 'midnight' ? '00:00' : '12:00', false);
  }

  // "at 19:00", "at 7.30pm", "at 7:30", "7pm", "at 7"
  {
    const m = s.find(/\b(?:at )?(\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?(?=\s|$)/i);
    if (m) {
      const hour = Number(m[1]);
      const minute = m[2] ? Number(m[2]) : 0;
      const hasClockShape = m[2] !== undefined || m[3] !== undefined || /^at /i.test(m[0]);
      // A bare number with no "at", no minutes and no am/pm is a number in a
      // sentence ("buy 2 pints"), not a time. Refusing it is the difference
      // between a parser and a guess.
      if (hasClockShape && hour <= 23 && minute <= 59) {
        const { hour: h, assumed } = resolveHour(hour, m[3] ?? null);
        return take(m, hhmm(h, minute), assumed && m[2] === undefined);
      }
    }
  }

  // "in the morning" / "in the afternoon" / "in the evening" / "tonight"
  {
    const m = s.find(/\b(?:in the )?(morning|afternoon|evening)\b/i);
    if (m) {
      const word = m[1].toLowerCase();
      const time = word === 'morning' ? '09:00' : word === 'afternoon' ? '14:00' : '18:00';
      return take(m, time, false);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------

function addMonthsISO(iso: DateOnly, months: number): DateOnly {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const total = (year * 12 + (month - 1)) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  // The 31st of a month with 30 days lands on the 30th, not the 1st of the
  // next one. Rolling over is the bug people notice a month later.
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(year: number, month: number, day: number): DateOnly | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** That day and month, this year if it is still to come, otherwise next year. */
function onOrAfter(today: DateOnly, month: number, day: number): DateOnly | null {
  const year = Number(today.slice(0, 4));
  const candidate = validDate(year, month, day);
  if (candidate && candidate >= today) return candidate;
  return validDate(year + 1, month, day);
}

/** That day of the month, this month if it is still to come, otherwise next. */
function dayOnOrAfter(today: DateOnly, day: number): DateOnly | null {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const candidate = validDate(year, month, day);
  if (candidate && candidate >= today) return candidate;
  const next = addMonthsISO(`${today.slice(0, 8)}01`, 1);
  return validDate(Number(next.slice(0, 4)), Number(next.slice(5, 7)), day);
}

// ---------------------------------------------------------------------------
// Turning a capture into instants
// ---------------------------------------------------------------------------

/**
 * The start and end of a captured event, as UTC instants.
 *
 * This is the one place the parse meets the clock, and it goes through
 * `londonInstant()` — which resolves a wall-clock time against Europe/London,
 * BST and all. A capture that said "half three" on 25 October 2026 means 15:30
 * on the 25-hour day, and the instant it produces is the one that renders back
 * as 15:30.
 */
export function captureInstants(
  capture: Capture,
  defaultMinutes = 60,
): { startsAt: string; endsAt: string; allDay: boolean } | null {
  if (!capture.date) return null;
  if (!capture.time) {
    const start = londonInstant(capture.date, '00:00');
    const end = londonInstant(addDaysISO(capture.date, 1), '00:00');
    return { startsAt: start.toISOString(), endsAt: end.toISOString(), allDay: true };
  }
  const start = londonInstant(capture.date, capture.time);
  const end = capture.endTime
    ? londonInstant(capture.date, capture.endTime)
    : new Date(start.getTime() + defaultMinutes * 60_000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString(), allDay: false };
}

/** One sentence describing what will be created. Shown before anything is. */
export function describeCapture(capture: Capture): string {
  const bits: string[] = [];
  bits.push(`${capture.kind === 'event' ? 'an' : 'a'} ${capture.kind}`);
  bits.push(`“${capture.title || 'untitled'}”`);
  if (capture.date) {
    bits.push(
      capture.time
        ? `on ${describeDate(capture.date)} at ${capture.time}`
        : `on ${describeDate(capture.date)}`,
    );
  }
  if (capture.endTime) bits.push(`until ${capture.endTime}`);
  if (capture.priority) bits.push(`at ${capture.priority} priority`);
  if (capture.assigneeHint) bits.push(`for ${capture.assigneeHint}`);
  return bits.join(' ');
}
