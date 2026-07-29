import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  captureInstants,
  describeCapture,
  describeDate,
  parseCapture,
  type Capture,
} from '@/lib/capture';

/**
 * NL capture.
 *
 * Two things are being pinned here. The first is the parsing, and in particular
 * the UK phrasing that a date library would get wrong: "a week on Tuesday",
 * "half three" meaning half past three, DD/MM never MM/DD. The second is the
 * promise in decision 8 — that this module never touches the network — which is
 * asserted by reading the source back, because a promise nothing checks is a
 * comment.
 *
 * Every date case is run from a fixed "today", and the clock-change cases are
 * run on both sides of both 2026 boundaries: BST begins 29 March and ends 25
 * October. A parser that is right in July and wrong in March is wrong.
 */

// Wednesday 15 July 2026, BST.
const SUMMER = { today: '2026-07-15' };
// Wednesday 14 January 2026, GMT.
const WINTER = { today: '2026-01-14' };

function p(text: string, clock = SUMMER): Capture {
  return parseCapture(text, clock);
}

describe('the local-only promise', () => {
  const source = readFileSync(new URL('../src/lib/capture/index.ts', import.meta.url), 'utf8');
  // The prose says the words the code must not contain, so the prose has to go
  // before the code is scanned for them.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('imports nothing but the date helpers', () => {
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['@/lib/format']);
  });

  it('contains no way to reach the network', () => {
    for (const forbidden of [
      'fetch(', 'XMLHttpRequest', 'WebSocket', 'node:http', 'node:https',
      'node:net', 'node:dgram', 'require(', 'import(', 'navigator.',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('does not reach for an AI provider', () => {
    expect(code).not.toContain('AiProvider');
    expect(code).not.toContain('integrations');
  });

  it('never asks the container what day it is', () => {
    // getDate()/getDay()/getMonth() answer in the container's timezone, which
    // is UTC — so a 23:30 BST capture would be filed under tomorrow for half
    // the year. Everything goes through src/lib/format.ts instead.
    expect(source).not.toMatch(/\.getDate\(\)/);
    expect(source).not.toMatch(/\.getDay\(\)/);
    expect(source).not.toMatch(/\.getMonth\(\)/);
    expect(source).not.toMatch(/\.getFullYear\(\)/);
  });
});

describe('a plain line', () => {
  it('is a task with nothing else on it', () => {
    const c = p('Put the bins out');
    expect(c.kind).toBe('task');
    expect(c.title).toBe('Put the bins out');
    expect(c.date).toBeNull();
    expect(c.time).toBeNull();
    expect(c.matches).toEqual([]);
  });

  it('survives an empty input', () => {
    const c = p('');
    expect(c.title).toBe('');
    expect(c.kind).toBe('task');
    expect(c.date).toBeNull();
  });

  it('collapses the whitespace somebody typed', () => {
    expect(p('  Put   the   bins  out ').title).toBe('Put the bins out');
  });

  it('does not read a number in a sentence as a time', () => {
    const c = p('buy 2 pints of milk');
    expect(c.time).toBeNull();
    expect(c.title).toBe('buy 2 pints of milk');
  });

  it('keeps a leading "the" — it is part of the title, not a stray connective', () => {
    expect(p('note: the boiler service is due').title).toBe('the boiler service is due');
  });
});

describe('relative days', () => {
  it('tomorrow', () => {
    expect(p('bins tomorrow').date).toBe('2026-07-16');
  });

  it('today', () => {
    expect(p('bins today').date).toBe('2026-07-15');
  });

  it('the day after tomorrow', () => {
    expect(p('bins the day after tomorrow').date).toBe('2026-07-17');
  });

  it('in three days', () => {
    expect(p('book the MOT in three days').date).toBe('2026-07-18');
  });

  it('in 10 days', () => {
    expect(p('book the MOT in 10 days').date).toBe('2026-07-25');
  });

  it('in a week', () => {
    expect(p('chase it in a week').date).toBe('2026-07-22');
  });

  it('in two months, landing on the same day of the month', () => {
    expect(p('renew it in two months').date).toBe('2026-09-15');
  });

  it('in a month from the 31st lands on the 30th, not the 1st', () => {
    expect(p('renew it in a month', { today: '2026-08-31' }).date).toBe('2026-09-30');
  });

  it('next week is the Monday of next week', () => {
    expect(p('sort it next week').date).toBe('2026-07-20');
  });

  it('next month is the first of next month', () => {
    expect(p('sort it next month').date).toBe('2026-08-01');
  });
});

describe('weekdays, the UK way', () => {
  // Wednesday 15 July 2026. The week runs Mon 13 – Sun 19.
  it('a bare weekday is the one coming', () => {
    expect(p('call the dentist Friday').date).toBe('2026-07-17');
  });

  it('"on Friday" is the same as a bare Friday', () => {
    expect(p('call the dentist on Friday').date).toBe('2026-07-17');
  });

  it('"this Friday" is the same again', () => {
    expect(p('call the dentist this Friday').date).toBe('2026-07-17');
  });

  it('today never means today — somebody who meant today would have typed it', () => {
    // Typed on a Wednesday, "on Wednesday" is the Wednesday coming.
    expect(p('call the dentist on Wednesday').date).toBe('2026-07-22');
  });

  it('"next Friday" is the Friday of next week', () => {
    expect(p('call the dentist next Friday').date).toBe('2026-07-24');
  });

  it('"next Monday" is next week even though Monday has already gone', () => {
    expect(p('call the dentist next Monday').date).toBe('2026-07-20');
  });

  it('"a week on Tuesday" is the Tuesday coming, plus seven', () => {
    expect(p('a week on Tuesday call the dentist').date).toBe('2026-07-28');
  });

  it('"a week tomorrow"', () => {
    expect(p('a week tomorrow').date).toBe('2026-07-23');
  });

  it('"a fortnight on Friday"', () => {
    expect(p('a fortnight on Friday').date).toBe('2026-07-31');
  });

  it('accepts the short forms', () => {
    expect(p('bins weds').date).toBe('2026-07-22');
    expect(p('bins thurs').date).toBe('2026-07-16');
  });

  it('at the weekend means Saturday', () => {
    expect(p('mow the lawn at the weekend').date).toBe('2026-07-18');
  });
});

describe('calendar dates, UK order', () => {
  it('reads 05/08 as the 5th of August, never the 8th of May', () => {
    expect(p('invoice Acme by 05/08').date).toBe('2026-08-05');
  });

  it('reads a four-digit year', () => {
    expect(p('renew the passport 03/02/2027').date).toBe('2027-02-03');
  });

  it('reads a two-digit year as this century', () => {
    expect(p('renew the passport 03/02/27').date).toBe('2027-02-03');
  });

  it('rolls a date already gone this year into next', () => {
    expect(p('birthday 03/02').date).toBe('2027-02-03');
  });

  it('refuses an impossible date rather than rolling it over', () => {
    // 31/02 is not a date; the parser leaves it in the title rather than
    // silently making it the 3rd of March.
    const c = p('order 31/02 widgets');
    expect(c.date).toBeNull();
    expect(c.title).toContain('31/02');
  });

  it('reads "5 August"', () => {
    expect(p('invoice Acme 5 August').date).toBe('2026-08-05');
  });

  it('reads "5th of August"', () => {
    expect(p('invoice Acme 5th of August').date).toBe('2026-08-05');
  });

  it('reads "August 5th"', () => {
    expect(p('invoice Acme August 5th').date).toBe('2026-08-05');
  });

  it('reads a short month name', () => {
    expect(p('invoice Acme 5 Aug').date).toBe('2026-08-05');
  });

  it('reads "the 5th" as this month when it is still to come', () => {
    expect(p('rent on the 25th').date).toBe('2026-07-25');
  });

  it('and as next month when it has gone', () => {
    expect(p('rent on the 5th').date).toBe('2026-08-05');
  });
});

describe('times', () => {
  it('"half three" is half past three in the afternoon', () => {
    expect(p('pick up Ravi at half three').time).toBe('15:30');
  });

  it('"half past three" is the same', () => {
    expect(p('pick up Ravi at half past three').time).toBe('15:30');
  });

  it('"half twelve" is half past twelve, middle of the day', () => {
    expect(p('lunch at half twelve').time).toBe('12:30');
  });

  it('"half seven" is the morning, and says it assumed so', () => {
    const c = p('gym at half seven');
    expect(c.time).toBe('07:30');
    expect(c.matches.find((m) => m.field === 'time')!.meaning).toContain('morning assumed');
  });

  it('"half seven pm" is not assumed at all', () => {
    const c = p('dinner at half seven pm');
    expect(c.time).toBe('19:30');
    expect(c.matches.find((m) => m.field === 'time')!.meaning).toBe('19:30');
  });

  it('quarter past four', () => {
    expect(p('meeting at quarter past four').time).toBe('16:15');
  });

  it('quarter to five', () => {
    expect(p('meeting at quarter to five').time).toBe('16:45');
  });

  it('quarter to one in the small hours stays on the clock, not below zero', () => {
    expect(p('meeting at quarter to 1am').time).toBe('00:45');
  });

  it('7pm', () => {
    expect(p('dinner at 7pm').time).toBe('19:00');
  });

  it('7am', () => {
    expect(p('gym at 7am').time).toBe('07:00');
  });

  it('12am is midnight and 12pm is midday', () => {
    expect(p('at 12am').time).toBe('00:00');
    expect(p('at 12pm').time).toBe('12:00');
  });

  it('19:00 is taken as typed', () => {
    expect(p('dinner at 19:00').time).toBe('19:00');
  });

  it('8.45am, the way a phone types it', () => {
    expect(p('school run at 8.45am').time).toBe('08:45');
  });

  it('midday and midnight', () => {
    expect(p('deadline at midday').time).toBe('12:00');
    expect(p('deadline at noon').time).toBe('12:00');
    expect(p('deadline at midnight').time).toBe('00:00');
  });

  it('a time with no date at all means today', () => {
    expect(p('school run at 8.45am').date).toBe('2026-07-15');
  });
});

describe('parts of the day', () => {
  it('tonight is today at 19:00', () => {
    const c = p('tonight take the bins out');
    expect(c.date).toBe('2026-07-15');
    expect(c.time).toBe('19:00');
    expect(c.title).toBe('take the bins out');
  });

  it('this evening keeps the evening — the date matcher must not eat it first', () => {
    const c = p('call mum this evening');
    expect(c.date).toBe('2026-07-15');
    expect(c.time).toBe('18:00');
    expect(c.title).toBe('call mum');
  });

  it('tomorrow morning', () => {
    const c = p('dentist tomorrow morning');
    expect(c.date).toBe('2026-07-16');
    expect(c.time).toBe('09:00');
  });

  it('Friday afternoon', () => {
    const c = p('delivery Friday afternoon');
    expect(c.date).toBe('2026-07-17');
    expect(c.time).toBe('14:00');
  });

  it('tomorrow night', () => {
    const c = p('drinks tomorrow night');
    expect(c.date).toBe('2026-07-16');
    expect(c.time).toBe('21:00');
  });
});

describe('a date and a time together', () => {
  it('"next Friday at half three" takes both, and leaves the title behind', () => {
    const c = p('next Friday at half three pick up Ravi');
    expect(c.date).toBe('2026-07-24');
    expect(c.time).toBe('15:30');
    expect(c.title).toBe('pick up Ravi');
  });

  it('a spent word cannot be read twice', () => {
    // "three" belongs to "half three"; nothing may read it back as a number of
    // days, and nothing may leave it in the title.
    const c = p('a week on Tuesday at half three');
    expect(c.date).toBe('2026-07-28');
    expect(c.time).toBe('15:30');
    expect(c.title).toBe('');
  });
});

describe('markers', () => {
  it('# is a space hint', () => {
    const c = p('invoice Acme #work');
    expect(c.spaceHint).toBe('work');
    expect(c.title).toBe('invoice Acme');
  });

  it('@ is an assignee hint', () => {
    const c = p('bins @danny');
    expect(c.assigneeHint).toBe('danny');
    expect(c.title).toBe('bins');
  });

  it('! is a priority', () => {
    expect(p('invoice Acme !urgent').priority).toBe('urgent');
    expect(p('tidy the shed !low').priority).toBe('low');
  });

  it('!! is urgent', () => {
    expect(p('invoice Acme !!').priority).toBe('urgent');
  });

  it('a bare ! is not a priority — it is punctuation', () => {
    const c = p('remember the milk!');
    expect(c.priority).toBeNull();
    expect(c.title).toBe('remember the milk!');
  });

  it('all four markers at once', () => {
    const c = p('invoice Acme #work @danny !urgent by 05/08');
    expect(c).toMatchObject({
      spaceHint: 'work',
      assigneeHint: 'danny',
      priority: 'urgent',
      date: '2026-08-05',
      title: 'invoice Acme',
    });
  });
});

describe('kinds', () => {
  it('a task by default', () => {
    expect(p('put the bins out').kind).toBe('task');
  });

  it('"note:" makes a note', () => {
    expect(p('note: the boiler is 12 years old').kind).toBe('note');
  });

  it('"event:" makes an event', () => {
    expect(p('event: something').kind).toBe('event');
  });

  it('"task:" makes a task even when it looks like a meeting', () => {
    expect(p('task: book the meeting room for 2pm').kind).toBe('task');
  });

  it('a meeting word plus a time makes an event', () => {
    expect(p('dinner with Sadia on Saturday at 7pm').kind).toBe('event');
  });

  it('a meeting word with no time is still a task', () => {
    // "sort out lunch" is a thing to do, not a thing in the diary.
    expect(p('sort out lunch').kind).toBe('task');
  });

  it('a time with no meeting word is still a task', () => {
    expect(p('put the bins out tomorrow at 7pm').kind).toBe('task');
  });
});

describe('durations', () => {
  it('for 90 minutes', () => {
    const c = p('meeting with Tom tomorrow at 2pm for 90 minutes');
    expect(c.time).toBe('14:00');
    expect(c.endTime).toBe('15:30');
  });

  it('for an hour', () => {
    expect(p('meeting tomorrow at 2pm for an hour').endTime).toBe('15:00');
  });

  it('for two hours', () => {
    expect(p('meeting tomorrow at 2pm for two hours').endTime).toBe('16:00');
  });

  it('a duration with no time gives no end time', () => {
    expect(p('tidy the shed for an hour').endTime).toBeNull();
  });

  it('clamps rather than rolling over midnight', () => {
    // An event that silently moved to tomorrow is worse than one that ends at
    // 23:59 and is obviously wrong.
    expect(p('meeting tomorrow at 11pm for three hours').endTime).toBe('23:59');
  });
});

describe('captureInstants across both 2026 clock changes', () => {
  // BST begins 01:00 GMT on Sunday 29 March 2026 and ends 02:00 BST on
  // Sunday 25 October 2026.
  it('a summer afternoon is an hour ahead of UTC', () => {
    const c = p('meeting tomorrow at half three');
    expect(captureInstants(c)!.startsAt).toBe('2026-07-16T14:30:00.000Z');
  });

  it('a winter afternoon is UTC', () => {
    const c = p('meeting tomorrow at half three', WINTER);
    expect(captureInstants(c)!.startsAt).toBe('2026-01-15T15:30:00.000Z');
  });

  it('the day before the clocks go forward is still GMT', () => {
    const c = p('meeting tomorrow at 9am', { today: '2026-03-27' });
    expect(c.date).toBe('2026-03-28');
    expect(captureInstants(c)!.startsAt).toBe('2026-03-28T09:00:00.000Z');
  });

  it('the day the clocks go forward is BST by 9am', () => {
    const c = p('meeting tomorrow at 9am', { today: '2026-03-28' });
    expect(c.date).toBe('2026-03-29');
    expect(captureInstants(c)!.startsAt).toBe('2026-03-29T08:00:00.000Z');
  });

  it('the day before the clocks go back is still BST', () => {
    const c = p('meeting tomorrow at 9am', { today: '2026-10-23' });
    expect(c.date).toBe('2026-10-24');
    expect(captureInstants(c)!.startsAt).toBe('2026-10-24T08:00:00.000Z');
  });

  it('the day the clocks go back is GMT by 9am', () => {
    const c = p('meeting tomorrow at 9am', { today: '2026-10-24' });
    expect(c.date).toBe('2026-10-25');
    expect(captureInstants(c)!.startsAt).toBe('2026-10-25T09:00:00.000Z');
  });

  it('an all-day capture on the short day is 23 hours long, not 24', () => {
    const c = p('MOT on 29 March', { today: '2026-03-01' });
    const i = captureInstants(c)!;
    expect(i.allDay).toBe(true);
    expect(new Date(i.endsAt).getTime() - new Date(i.startsAt).getTime()).toBe(23 * 3_600_000);
  });

  it('and 25 hours long on the long one', () => {
    const c = p('MOT on 25 October', { today: '2026-10-01' });
    const i = captureInstants(c)!;
    expect(new Date(i.endsAt).getTime() - new Date(i.startsAt).getTime()).toBe(25 * 3_600_000);
  });

  it('"a week on Tuesday" does not lose a day across the spring boundary', () => {
    // Tuesday 24 March → the Tuesday coming is the 31st → plus seven is 7 April,
    // with the clocks going forward in between.
    expect(p('call the dentist a week on Tuesday', { today: '2026-03-24' }).date).toBe('2026-04-07');
  });

  it('nor across the autumn one', () => {
    expect(p('call the dentist a week on Tuesday', { today: '2026-10-20' }).date).toBe('2026-11-03');
  });

  it('gives nothing for a capture with no date', () => {
    expect(captureInstants(p('put the bins out'))).toBeNull();
  });

  it('defaults an event to an hour when no duration was typed', () => {
    const i = captureInstants(p('meeting tomorrow at 2pm'))!;
    expect(new Date(i.endsAt).getTime() - new Date(i.startsAt).getTime()).toBe(3_600_000);
  });
});

describe('showing the working', () => {
  it('reports every span it consumed and what it took it to mean', () => {
    const c = p('invoice Acme #work @danny !urgent by 05/08');
    expect(c.matches.map((m) => m.field).sort()).toEqual([
      'assignee', 'date', 'priority', 'space',
    ]);
    expect(c.matches.find((m) => m.field === 'date')!.text).toBe('05/08');
    expect(c.matches.find((m) => m.field === 'date')!.meaning).toBe('Wednesday 5 August');
  });

  it('says what it assumed about a bare hour', () => {
    expect(p('gym at 7').matches.find((m) => m.field === 'time')!.meaning).toBe(
      '07:00 — morning assumed',
    );
  });

  it('describes the whole capture in one sentence', () => {
    expect(describeCapture(p('dinner with Sadia on Saturday at 7pm'))).toBe(
      'an event “dinner with Sadia” on Saturday 18 July at 19:00',
    );
  });

  it('says untitled rather than nothing when only a date was typed', () => {
    expect(describeCapture(p('tomorrow'))).toContain('untitled');
  });

  it('describeDate is UK order and names the day', () => {
    expect(describeDate('2026-07-15')).toBe('Wednesday 15 July');
    expect(describeDate('2026-01-01')).toBe('Thursday 1 January');
  });
});

describe('parsing twice changes nothing', () => {
  it('is a pure function of its input and its clock', () => {
    const line = 'meeting with Tom next Wednesday at quarter past four for 90 minutes #work';
    expect(p(line)).toEqual(p(line));
  });
});
