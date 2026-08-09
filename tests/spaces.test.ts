import { describe, expect, it } from 'vitest';
import { SPACE_KINDS, isSpaceKind, shortLabelFrom, spaceKindPreset } from '@/lib/spaces';

/**
 * Creating a space.
 *
 * The create form posts a name and a kind, and the server action turns those
 * into the five columns `app.create_space` takes. Both halves read the table
 * below, so what is worth pinning is the table's shape and the one piece of
 * arithmetic: `spaces_short_label_len` is a CHECK constraint of 1..12, and a
 * name longer than that must arrive trimmed rather than as a failed insert
 * somebody sees as "That space was not created."
 */
describe('space kinds', () => {
  it('offers exactly the four members of app.space_kind', () => {
    expect(SPACE_KINDS.map((k) => k.kind)).toEqual([
      'personal',
      'household',
      'work',
      'project',
    ]);
  });

  it('gives every kind a colour and an icon, so no indicator renders bare', () => {
    for (const k of SPACE_KINDS) {
      expect(k.colour).not.toBe('');
      expect(k.icon).not.toBe('');
      expect(k.label).not.toBe('');
    }
  });

  it('recognises its own kinds and nothing else', () => {
    expect(isSpaceKind('household')).toBe(true);
    expect(isSpaceKind('holiday')).toBe(false);
    expect(isSpaceKind('')).toBe(false);
  });

  /**
   * A posted form field is a string from a browser and can be anything. The
   * fallback is `personal` rather than a throw: the worst case is a space whose
   * icon is not the one somebody expected, which they can change, and the
   * alternative is losing the name they typed to an error page.
   */
  it('falls back to personal for a kind it does not know', () => {
    expect(spaceKindPreset('work').kind).toBe('work');
    expect(spaceKindPreset('nonsense').kind).toBe('personal');
    expect(spaceKindPreset('').kind).toBe('personal');
  });
});

describe('shortLabelFrom', () => {
  it('keeps a name that already fits', () => {
    expect(shortLabelFrom('Home')).toBe('Home');
    expect(shortLabelFrom('Wilson House')).toBe('Wilson House'); // exactly 12
  });

  it('collapses the whitespace a name was typed with', () => {
    expect(shortLabelFrom('  Home  ')).toBe('Home');
    expect(shortLabelFrom('Wilson   House')).toBe('Wilson House');
  });

  it('trims a long name at a word boundary rather than mid-word', () => {
    expect(shortLabelFrom('Weekend cottage')).toBe('Weekend');
    expect(shortLabelFrom('Kitchen renovation')).toBe('Kitchen');
  });

  it('trims a long single word at the limit, because there is no boundary', () => {
    expect(shortLabelFrom('Supercalifragilistic')).toBe('Supercalifra');
    expect(shortLabelFrom('Supercalifragilistic').length).toBeLessThanOrEqual(12);
  });

  /** Every result has to satisfy `spaces_short_label_len`: 1..12 characters. */
  it('never returns more than the constraint allows', () => {
    const names = [
      'a',
      'Home',
      'Weekend cottage in the hills',
      'x'.repeat(80),
      'The one with the very long name indeed',
    ];
    for (const name of names) {
      const label = shortLabelFrom(name);
      expect(label.length).toBeGreaterThanOrEqual(1);
      expect(label.length).toBeLessThanOrEqual(12);
    }
  });
});
