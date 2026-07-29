import { describe, expect, it } from 'vitest';
import {
  describeCounts,
  isSearchKind,
  looseStem,
  MAX_QUERY,
  mergeResults,
  parseQuery,
  snippet,
  type Ranked,
  type SearchKind,
} from '@/lib/search';

/**
 * Search's pure half.
 *
 * What is *findable* is decided by RLS and by five partial indexes that all say
 * `where not is_locked`; none of that can be tested here and all of it is
 * tested in pgTAP and in the smoke suite. What can be tested here is the part
 * that would quietly go wrong: a snippet that cuts a word in half, a highlight
 * that overlaps itself, and a merge that lets one kind bury the other four.
 */

describe('parseQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(parseQuery('  bins   out  ').text).toBe('bins out');
  });

  it('is not searchable when empty', () => {
    expect(parseQuery('').searchable).toBe(false);
    expect(parseQuery('   ').searchable).toBe(false);
    expect(parseQuery(null).searchable).toBe(false);
    expect(parseQuery(undefined).searchable).toBe(false);
  });

  it('caps a silly query rather than sending it', () => {
    const long = 'a'.repeat(MAX_QUERY + 500);
    expect(parseQuery(long).text.length).toBe(MAX_QUERY);
  });

  it('lower-cases the highlight terms and de-duplicates them', () => {
    expect(parseQuery('Bins BINS bins').terms).toEqual(['bins']);
  });

  it('does not highlight websearch operators', () => {
    expect(parseQuery('bins or bags').terms).toEqual(['bins', 'bags']);
    expect(parseQuery('bins and bags').terms).toEqual(['bins', 'bags']);
  });

  it('does not highlight a negated term', () => {
    expect(parseQuery('bins -recycling').terms).toEqual(['bins']);
  });

  it('keeps the phrase text intact for Postgres but strips the quotes for highlighting', () => {
    const q = parseQuery('"school run"');
    expect(q.text).toBe('"school run"');
    expect(q.terms).toEqual(['school', 'run']);
  });

  it('a query of nothing but operators is not searchable', () => {
    expect(parseQuery('or and').searchable).toBe(false);
  });
});

describe('snippet', () => {
  const body =
    'The bin bags live in the shed at the bottom of the garden, behind the bikes and the ' +
    'broken parasol nobody has thrown away. Take them out on a Tuesday night before the ' +
    'lorry comes round at half six on the Wednesday morning.';

  it('returns nothing for an empty body', () => {
    expect(snippet('', ['bins'])).toEqual([]);
    expect(snippet('   \n  ', ['bins'])).toEqual([]);
  });

  it('marks the matching term', () => {
    const segments = snippet('Put the bins out', ['bins']);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['bins']);
  });

  it('matches case-insensitively but keeps the original casing', () => {
    const segments = snippet('Put the BINS out', ['bins']);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['BINS']);
  });

  it('reassembles to the original text when the whole body fits', () => {
    const text = 'Put the bins out';
    expect(snippet(text, ['bins']).map((s) => s.text).join('')).toBe(text);
  });

  it('collapses newlines so a Markdown body reads as one line', () => {
    const segments = snippet('# Heading\n\nthe bins\n\n- a list', ['bins']);
    expect(segments.map((s) => s.text).join('')).not.toContain('\n');
  });

  it('marks every occurrence of a term', () => {
    const segments = snippet('bins and more bins', ['bins']);
    expect(segments.filter((s) => s.hit)).toHaveLength(2);
  });

  it('marks two different terms', () => {
    const segments = snippet('the bins and the bags', ['bins', 'bags']);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['bins', 'bags']);
  });

  it('never marks overlapping ranges twice', () => {
    // Two terms that stem to the same thing account for the same word once,
    // rather than producing two overlapping segments over one span.
    const segments = snippet('the bins', ['bins', 'bin']);
    expect(segments.filter((s) => s.hit)).toHaveLength(1);
    expect(segments.map((s) => s.text).join('')).toBe('the bins');
  });

  it('shows the opening when nothing in the body matches', () => {
    const segments = snippet(body, ['nowhere']);
    expect(segments[0].text.startsWith('The bin bags')).toBe(true);
    expect(segments.some((s) => s.hit)).toBe(false);
  });

  it('windows around a match late in the body', () => {
    const segments = snippet(body, ['lorry'], 80);
    const text = segments.map((s) => s.text).join('');
    expect(text).toContain('lorry');
    expect(text.startsWith('…')).toBe(true);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['lorry']);
  });

  it('does not start a window mid-word', () => {
    const segments = snippet(body, ['lorry'], 80);
    const first = segments.find((s) => s.text !== '…');
    // The first real segment begins at a word start, not inside one.
    expect(first!.text[0]).not.toBe(' ');
    expect(body).toContain(first!.text.trimEnd().split(' ')[0]);
  });

  it('marks the end with an ellipsis when there is more body after the window', () => {
    const segments = snippet(body, ['bin'], 60);
    expect(segments[segments.length - 1].text).toBe('…');
  });

  it('adds no ellipsis when the window reaches the end', () => {
    const segments = snippet('Put the bins out', ['bins'], 500);
    expect(segments.some((s) => s.text === '…')).toBe(false);
  });

  it('drops a hit that falls outside the window rather than slicing it', () => {
    const long = 'bins ' + 'x'.repeat(400) + ' bins';
    const segments = snippet(long, ['bins'], 60);
    expect(segments.filter((s) => s.hit)).toHaveLength(1);
  });

  it('ignores an empty term', () => {
    expect(snippet('Put the bins out', ['']).some((s) => s.hit)).toBe(false);
  });

  it('never returns an empty segment', () => {
    expect(snippet('bins', ['bins']).every((s) => s.text.length > 0)).toBe(true);
  });
});

describe('looseStem', () => {
  it('drops a plural s', () => {
    expect(looseStem('bins')).toBe('bin');
    expect(looseStem('bags')).toBe('bag');
  });

  it('leaves a word that merely ends in ss', () => {
    expect(looseStem('glass')).toBe('glass');
  });

  it('keeps the e on an -es word that is not a sibilant plural', () => {
    // "notes" must stem to "note", not "not" — otherwise searching for a note
    // emboldens every "not" on the page.
    expect(looseStem('notes')).toBe('note');
  });

  it('handles sibilant plurals', () => {
    expect(looseStem('boxes')).toBe('box');
    expect(looseStem('churches')).toBe('church');
  });

  it('handles -ies', () => {
    expect(looseStem('groceries')).toBe('grocery');
  });

  it('handles -ing and -ed', () => {
    expect(looseStem('walking')).toBe('walk');
    expect(looseStem('walked')).toBe('walk');
  });

  it('leaves short words alone', () => {
    expect(looseStem('is')).toBe('is');
    expect(looseStem('bed')).toBe('bed');
  });

  it('drops a possessive', () => {
    expect(looseStem("Sadia's")).toBe('sadia');
    expect(looseStem('Sadia’s')).toBe('sadia');
  });
});

describe('snippet, stemmed', () => {
  it('marks the stemmed form Postgres actually matched', () => {
    // Typing "bins" returns a task whose title says "bin bags"; a highlighter
    // that looked for the literal string would mark nothing on the very row it
    // just found.
    const segments = snippet('The bin bags are in the shed', ['bins']);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['bin']);
  });

  it('marks the plural when the singular was typed', () => {
    const segments = snippet('Put the bins out', ['bin']);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['bins']);
  });

  it('does not mark a word that merely contains the term', () => {
    // Postgres would not have matched "nothing" for "not", so nor do we.
    expect(snippet('nothing at all', ['not']).some((s) => s.hit)).toBe(false);
  });

  it('marks a whole word, not the prefix of it', () => {
    const segments = snippet('the bins', ['bins']);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['bins']);
  });
});

describe('mergeResults', () => {
  const r = (kind: SearchKind, rank: number): Ranked => ({ kind, rank });

  it('returns nothing for nothing', () => {
    expect(mergeResults([])).toEqual([]);
    expect(mergeResults([[], [], []])).toEqual([]);
  });

  it('orders one kind by rank', () => {
    const out = mergeResults([[r('task', 0.1), r('task', 0.9), r('task', 0.5)]]);
    expect(out.map((x) => x.rank)).toEqual([0.9, 0.5, 0.1]);
  });

  it('promotes the first result of every kind ahead of the second of any kind', () => {
    // Ten strong tasks must not bury the one person whose name was typed.
    const tasks = Array.from({ length: 10 }, () => r('task', 0.9));
    const people = [r('person', 0.2)];
    const out = mergeResults([tasks, people]);
    expect(out.slice(0, 2).map((x) => x.kind).sort()).toEqual(['person', 'task']);
  });

  it('orders within a round by rank', () => {
    const out = mergeResults([[r('task', 0.3)], [r('note', 0.8)], [r('place', 0.5)]]);
    expect(out.map((x) => x.kind)).toEqual(['note', 'place', 'task']);
  });

  it('keeps taking from the kinds that still have results', () => {
    const out = mergeResults([[r('task', 0.9), r('task', 0.8), r('task', 0.7)], [r('note', 0.95)]]);
    expect(out.map((x) => x.kind)).toEqual(['note', 'task', 'task', 'task']);
  });

  it('respects the limit', () => {
    const out = mergeResults([Array.from({ length: 40 }, () => r('task', 0.5))], 10);
    expect(out).toHaveLength(10);
  });

  it('does not mutate its input', () => {
    const tasks = [r('task', 0.1), r('task', 0.9)];
    mergeResults([tasks]);
    expect(tasks.map((t) => t.rank)).toEqual([0.1, 0.9]);
  });
});

describe('describeCounts', () => {
  it('is empty for nothing', () => {
    expect(describeCounts({})).toBe('');
  });

  it('uses the singular for one', () => {
    expect(describeCounts({ note: 1 })).toBe('1 note');
  });

  it('uses the plural for more', () => {
    expect(describeCounts({ task: 3 })).toBe('3 tasks');
  });

  it('says people, not persons', () => {
    expect(describeCounts({ person: 2 })).toBe('2 people');
  });

  it('keeps the kinds in a fixed order and skips the empty ones', () => {
    expect(describeCounts({ place: 1, task: 2, person: 1 })).toBe('2 tasks · 1 person · 1 place');
  });
});

describe('isSearchKind', () => {
  it('accepts the five kinds', () => {
    for (const k of ['task', 'note', 'person', 'event', 'place']) {
      expect(isSearchKind(k)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isSearchKind('rule')).toBe(false);
    expect(isSearchKind('')).toBe(false);
    expect(isSearchKind(null)).toBe(false);
    expect(isSearchKind(3)).toBe(false);
  });
});
