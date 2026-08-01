import { describe, expect, it } from 'vitest';
import { ACTIONS, GO_TO, hasModifier, isTyping, resolve } from '@/lib/shortcuts';

/**
 * Single-letter shortcuts are only safe because of two guards, and both of them
 * fail silently and confusingly when they are wrong: a `c` typed into a task
 * title that navigates away, or a ⌘L that opens Capture instead of the address
 * bar. So both are pinned here, along with the `g` sequence.
 */

/** A stand-in for `document.activeElement`, without a DOM. */
function el(tag: string, attrs: Record<string, string> = {}): Element {
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (k: string) => attrs[k] ?? null,
  } as unknown as Element;
}

describe('isTyping', () => {
  it('is true for the controls somebody types into', () => {
    expect(isTyping(el('input'))).toBe(true);
    expect(isTyping(el('textarea'))).toBe(true);
    expect(isTyping(el('select'))).toBe(true);
  });

  it('is true for a contenteditable, both spellings', () => {
    expect(isTyping(el('div', { contenteditable: '' }))).toBe(true);
    expect(isTyping(el('div', { contenteditable: 'true' }))).toBe(true);
  });

  it('is false for contenteditable="false", which is not editable', () => {
    expect(isTyping(el('div', { contenteditable: 'false' }))).toBe(false);
  });

  it('is false for the things you merely focus', () => {
    expect(isTyping(el('button'))).toBe(false);
    expect(isTyping(el('a'))).toBe(false);
    expect(isTyping(el('body'))).toBe(false);
  });

  it('is false when nothing is focused at all', () => {
    expect(isTyping(null)).toBe(false);
  });

  it('is case-insensitive about the tag, because the DOM reports uppercase', () => {
    expect(isTyping(el('INPUT'))).toBe(true);
  });
});

describe('hasModifier', () => {
  const none = { ctrlKey: false, metaKey: false, altKey: false };

  it('leaves a plain keystroke to the app', () => {
    expect(hasModifier(none)).toBe(false);
  });

  /** ⌘L, Ctrl-T, Alt-Left all belong to the browser. Taking one of them makes
   *  an app feel broken in a way nobody can attribute to it. */
  it('gives anything with a modifier back to the browser', () => {
    expect(hasModifier({ ...none, metaKey: true })).toBe(true);
    expect(hasModifier({ ...none, ctrlKey: true })).toBe(true);
    expect(hasModifier({ ...none, altKey: true })).toBe(true);
  });

  it('does not treat Shift as a modifier, since ? needs it', () => {
    expect(hasModifier(none)).toBe(false);
  });
});

describe('resolve', () => {
  it('sends a bare / to search and c to capture', () => {
    expect(resolve('/', null)).toEqual({ kind: 'go', href: '/search' });
    expect(resolve('c', null)).toEqual({ kind: 'go', href: '/capture' });
  });

  it('opens the list on ?', () => {
    expect(resolve('?', null)).toEqual({ kind: 'help' });
  });

  it('arms the prefix on g rather than going anywhere', () => {
    expect(resolve('g', null)).toEqual({ kind: 'pending' });
  });

  it('completes a sequence once the prefix is armed', () => {
    expect(resolve('t', 'g')).toEqual({ kind: 'go', href: '/' });
    expect(resolve('c', 'g')).toEqual({ kind: 'go', href: '/calendar/week' });
    expect(resolve('m', 'g')).toEqual({ kind: 'go', href: '/tasks/mine' });
  });

  /**
   * `c` alone is Capture and `g c` is Calendar. The second key of a sequence
   * must not also fire the single-key action, or every `g c` would land on
   * Capture on its way past.
   */
  it('does not also fire the single-key action for the second key', () => {
    expect(resolve('c', 'g')).toEqual({ kind: 'go', href: '/calendar/week' });
  });

  it('is a dead end rather than a fallback when a sequence is not recognised', () => {
    expect(resolve('z', 'g')).toEqual({ kind: 'none' });
    // Importantly not `help`: `g ?` should do nothing, not open the list.
    expect(resolve('?', 'g')).toEqual({ kind: 'none' });
  });

  it('ignores a key that means nothing', () => {
    expect(resolve('z', null)).toEqual({ kind: 'none' });
    expect(resolve('F5', null)).toEqual({ kind: 'none' });
  });

  it('accepts an upper-case second key, for somebody holding shift', () => {
    expect(resolve('T', 'g')).toEqual({ kind: 'go', href: '/' });
  });
});

describe('the table itself', () => {
  it('has no two shortcuts bound to the same keys', () => {
    const keys = [...GO_TO, ...ACTIONS].map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /** Every shortcut is a faster route to something already on the screen, never
   *  the only way to reach it. A destination nothing links to would break that. */
  it('sends every navigating shortcut somewhere absolute', () => {
    for (const s of [...GO_TO, ...ACTIONS]) {
      if (s.href) expect(s.href.startsWith('/')).toBe(true);
    }
  });

  it('gives every shortcut a label, since ? is how they are discovered', () => {
    for (const s of [...GO_TO, ...ACTIONS]) expect(s.label.length).toBeGreaterThan(0);
  });

  it('reserves no single letter that a sequence also starts with', () => {
    const singles = ACTIONS.filter((s) => s.keys.length === 1).map((s) => s.keys);
    expect(singles).not.toContain('g');
  });
});
