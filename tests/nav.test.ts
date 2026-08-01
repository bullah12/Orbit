import { describe, expect, it } from 'vitest';
import { isActive } from '@/components/NavLink';

/**
 * Where you are standing.
 *
 * Until this existed every link in the sidebar rendered identically, so on `/`
 * the word "Today" looked exactly like "Travel" and nothing told a screen
 * reader either. `aria-current="page"` is the fix and this function decides it,
 * so the rule is worth pinning: the interesting cases are all the ones where a
 * prefix match would be wrong.
 */
describe('isActive', () => {
  it('matches the landing page exactly, and not every path beneath it', () => {
    expect(isActive('/', '/', null)).toBe(true);
    expect(isActive('/', '/notes', null)).toBe(false);
    expect(isActive('/', '/calendar/week', null)).toBe(false);
  });

  it('matches a section from its own page and from a page inside it', () => {
    expect(isActive('/notes', '/notes', null)).toBe(true);
    expect(isActive('/notes', '/notes/abc-123', null)).toBe(true);
  });

  /**
   * `/people` must not light up on `/places`, and `/travel` must not light up
   * on `/travels-something`. A bare `startsWith` gets both wrong, which is why
   * the separator is part of the test rather than part of the prefix.
   */
  it('does not match a different section that merely shares a prefix', () => {
    expect(isActive('/people', '/places', null)).toBe(false);
    expect(isActive('/place', '/places', null)).toBe(false);
    expect(isActive('/travel', '/travelling', null)).toBe(false);
  });

  it('treats a nested route as inside its section', () => {
    expect(isActive('/calendar/week', '/calendar/week', null)).toBe(true);
    expect(isActive('/travel', '/travel/trip/9', null)).toBe(true);
  });

  describe('spaces, which are the same route with a parameter', () => {
    const SPACE = 'aaaa-1111';
    const OTHER = 'bbbb-2222';

    it('matches a space link on its own space and no other', () => {
      expect(isActive(`/tasks/all?space=${SPACE}`, '/tasks/all', SPACE)).toBe(true);
      expect(isActive(`/tasks/all?space=${SPACE}`, '/tasks/all', OTHER)).toBe(false);
      expect(isActive(`/tasks/all?space=${SPACE}`, '/tasks/all', null)).toBe(false);
    });

    /**
     * The case the whole `spaceParam` argument exists for. A space link points
     * at `/tasks/all`, so while you are viewing a space through it, a plain
     * prefix match would light up the "All open" smart list as well — two
     * things claiming to be where you are.
     */
    it('does not also light up the smart list a space link happens to point at', () => {
      expect(isActive('/tasks/all', '/tasks/all', SPACE)).toBe(false);
      expect(isActive('/tasks/mine', '/tasks/mine', SPACE)).toBe(false);
    });

    it('lights up the smart list again once no space is being viewed', () => {
      expect(isActive('/tasks/all', '/tasks/all', null)).toBe(true);
      expect(isActive('/tasks/mine', '/tasks/mine', null)).toBe(true);
    });

    /**
     * A space parameter belongs to the tasks routes. It must not stop the
     * calendar or anything else from showing where you are.
     */
    it('leaves other sections alone when a space parameter is present', () => {
      expect(isActive('/calendar/week', '/calendar/week', SPACE)).toBe(true);
      expect(isActive('/', '/', SPACE)).toBe(true);
    });
  });
});
