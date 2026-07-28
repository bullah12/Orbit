import { describe, expect, it } from 'vitest';
import {
  countByList,
  inSmartList,
  isOpen,
  smartListsFor,
  type Clock,
  type SmartListTask,
} from '@/lib/smartlists';

/**
 * Smart lists are derived, never stored, which means the only thing that can be
 * wrong about them is the rule. These tests pin every rule, and in particular
 * the overlaps — an overdue task is *also* in Today, and forgetting that is how
 * you end up with a Today count that does not match the Today page.
 */

const NOW = new Date('2026-07-15T09:00:00Z'); // Wednesday, BST
const clock: Clock = { today: '2026-07-15', now: NOW };

function task(over: Partial<SmartListTask> = {}): SmartListTask {
  return { status: 'todo', dueOn: null, deferredUntil: null, completedAt: null, ...over };
}

describe('isOpen', () => {
  it('counts todo, doing and blocked as open', () => {
    expect(isOpen('todo')).toBe(true);
    expect(isOpen('doing')).toBe(true);
    expect(isOpen('blocked')).toBe(true);
  });

  it('does not count done or dropped', () => {
    expect(isOpen('done')).toBe(false);
    expect(isOpen('dropped')).toBe(false);
  });
});

describe('today', () => {
  it('includes a task due today', () => {
    expect(inSmartList('today', task({ dueOn: '2026-07-15' }), clock)).toBe(true);
  });

  it('also includes overdue tasks — this is the overlap that gets forgotten', () => {
    const overdue = task({ dueOn: '2026-06-01' });
    expect(inSmartList('today', overdue, clock)).toBe(true);
    expect(inSmartList('overdue', overdue, clock)).toBe(true);
  });

  it('excludes a task due tomorrow', () => {
    expect(inSmartList('today', task({ dueOn: '2026-07-16' }), clock)).toBe(false);
  });

  it('excludes a completed task even if it was due today', () => {
    const done = task({ status: 'done', dueOn: '2026-07-15', completedAt: NOW.toISOString() });
    expect(inSmartList('today', done, clock)).toBe(false);
  });

  it('includes a blocked task due today — blocked is still open', () => {
    expect(inSmartList('today', task({ status: 'blocked', dueOn: '2026-07-15' }), clock)).toBe(true);
  });

  it('excludes a task with no date, however urgent it feels', () => {
    expect(inSmartList('today', task(), clock)).toBe(false);
  });
});

describe('overdue', () => {
  it('excludes a task due today — today is not yet late', () => {
    expect(inSmartList('overdue', task({ dueOn: '2026-07-15' }), clock)).toBe(false);
  });

  it('includes yesterday', () => {
    expect(inSmartList('overdue', task({ dueOn: '2026-07-14' }), clock)).toBe(true);
  });

  it('does not become overdue an hour early when the clocks go back', () => {
    // On 25 October the day is 25 hours long. A task due that day must not be
    // overdue while it is still that day.
    const bstEnd: Clock = { today: '2026-10-25', now: new Date('2026-10-25T23:30:00Z') };
    expect(inSmartList('overdue', task({ dueOn: '2026-10-25' }), bstEnd)).toBe(false);
    expect(inSmartList('today', task({ dueOn: '2026-10-25' }), bstEnd)).toBe(true);
  });
});

describe('upcoming — the next fortnight', () => {
  it('includes day 1 and day 14', () => {
    expect(inSmartList('upcoming', task({ dueOn: '2026-07-16' }), clock)).toBe(true);
    expect(inSmartList('upcoming', task({ dueOn: '2026-07-29' }), clock)).toBe(true);
  });

  it('excludes day 15 and today', () => {
    expect(inSmartList('upcoming', task({ dueOn: '2026-07-30' }), clock)).toBe(false);
    expect(inSmartList('upcoming', task({ dueOn: '2026-07-15' }), clock)).toBe(false);
  });

  it('spans the BST boundary without losing or gaining a day', () => {
    const beforeEnd: Clock = { today: '2026-10-18', now: new Date('2026-10-18T09:00:00Z') };
    // 1 November is 14 days after 18 October, with the clocks going back between.
    expect(inSmartList('upcoming', task({ dueOn: '2026-11-01' }), beforeEnd)).toBe(true);
    expect(inSmartList('upcoming', task({ dueOn: '2026-11-02' }), beforeEnd)).toBe(false);
  });

  it('excludes blocked tasks — those belong in Waiting', () => {
    expect(inSmartList('upcoming', task({ status: 'blocked', dueOn: '2026-07-20' }), clock))
      .toBe(false);
  });
});

describe('inbox — undecided', () => {
  it('is a todo with no date and no deferral', () => {
    expect(inSmartList('inbox', task(), clock)).toBe(true);
  });

  it('a date is a decision, so it leaves the inbox', () => {
    expect(inSmartList('inbox', task({ dueOn: '2026-08-01' }), clock)).toBe(false);
  });

  it('so is a deferral', () => {
    expect(inSmartList('inbox', task({ deferredUntil: '2026-09-01T00:00:00Z' }), clock))
      .toBe(false);
  });

  it('starting the task is a decision too', () => {
    expect(inSmartList('inbox', task({ status: 'doing' }), clock)).toBe(false);
  });
});

describe('someday — deliberately deferred', () => {
  it('includes a deferral still in the future', () => {
    expect(inSmartList('someday', task({ deferredUntil: '2026-09-01T00:00:00Z' }), clock))
      .toBe(true);
  });

  it('drops out once the deferral has passed', () => {
    expect(inSmartList('someday', task({ deferredUntil: '2026-07-01T00:00:00Z' }), clock))
      .toBe(false);
  });

  it('compares as an instant, not as a date — a deferral to later today still counts', () => {
    expect(inSmartList('someday', task({ deferredUntil: '2026-07-15T18:00:00Z' }), clock))
      .toBe(true);
    expect(inSmartList('someday', task({ deferredUntil: '2026-07-15T08:00:00Z' }), clock))
      .toBe(false);
  });
});

describe('done — the last 30 days', () => {
  it('includes something completed this morning', () => {
    expect(inSmartList('done', task({ status: 'done', completedAt: '2026-07-15T08:00:00Z' }), clock))
      .toBe(true);
  });

  it('excludes something completed two months ago', () => {
    expect(inSmartList('done', task({ status: 'done', completedAt: '2026-05-01T08:00:00Z' }), clock))
      .toBe(false);
  });

  it('excludes an open task, whatever its completed_at says', () => {
    expect(inSmartList('done', task({ completedAt: '2026-07-15T08:00:00Z' }), clock)).toBe(false);
  });
});

describe('waiting and all', () => {
  it('waiting is exactly the blocked tasks', () => {
    expect(inSmartList('waiting', task({ status: 'blocked' }), clock)).toBe(true);
    expect(inSmartList('waiting', task({ status: 'todo' }), clock)).toBe(false);
  });

  it('all open is every open task regardless of date', () => {
    expect(inSmartList('all', task(), clock)).toBe(true);
    expect(inSmartList('all', task({ status: 'blocked', dueOn: '2020-01-01' }), clock)).toBe(true);
    expect(inSmartList('all', task({ status: 'done', completedAt: NOW.toISOString() }), clock))
      .toBe(false);
    expect(inSmartList('all', task({ status: 'dropped' }), clock)).toBe(false);
  });
});

describe('sub-tasks', () => {
  it('never appear in a list of their own — they belong to their parent', () => {
    const sub = task({ dueOn: '2026-07-15', parentTaskId: 'a-parent' });
    expect(smartListsFor(sub, clock)).toEqual([]);
  });
});

describe('smartListsFor', () => {
  it('reports every list a task is in, not just the first', () => {
    expect(smartListsFor(task({ dueOn: '2026-06-01' }), clock).sort())
      .toEqual(['all', 'overdue', 'today']);
  });

  it('reports nothing for a dropped task', () => {
    expect(smartListsFor(task({ status: 'dropped' }), clock)).toEqual([]);
  });

  it('returns an empty list for an unknown list key rather than throwing', () => {
    expect(inSmartList('nonsense', task(), clock)).toBe(false);
  });
});

describe('countByList', () => {
  it('counts a task once per list it belongs to, and reports zeroes', () => {
    const counts = countByList(
      [
        task({ dueOn: '2026-06-01' }), // overdue + today + all
        task({ dueOn: '2026-07-15' }), // today + all
        task(), // inbox + all
        task({ status: 'done', completedAt: '2026-07-14T10:00:00Z' }), // done
      ],
      clock,
    );
    expect(counts).toEqual({
      today: 2, overdue: 1, upcoming: 0, inbox: 1,
      waiting: 0, someday: 0, done: 1, all: 3,
    });
  });
});
