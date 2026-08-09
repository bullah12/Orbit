import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastOfOklch, contrastRatio, oklchToSrgb, parseOklch } from '@/lib/colour';

/**
 * Contrast, measured rather than eyeballed, in both themes.
 *
 * The tokens live in globals.css and are read from it here, so adding a
 * category colour that reads badly on the chip fill fails this test rather
 * than shipping. Thresholds:
 *
 *   4.5:1  body text and anything a person has to read to use the app
 *   3.0:1  large/bold text and the chip labels, which are 11px semibold on a
 *          tinted fill — WCAG's large-text threshold does not strictly apply
 *          at that size, so 3.0 is the floor and the comment says where each
 *          pair actually lands
 *
 * The chips are never the only signal: every one carries an icon and a label,
 * so colour failing for a given reader costs nothing. That is why 3.0 is
 * acceptable here and would not be for body text.
 */

const css = readFileSync(
  fileURLToPath(new URL('../src/app/globals.css', import.meta.url)),
  'utf8',
);

/**
 * Both halves of every `light-dark()` pair.
 *
 * Session 12 merged the `:root` block and its
 * `@media (prefers-color-scheme: dark)` counterpart into one declaration per
 * token — `light-dark(<light>, <dark>)` — so that the manual theme override is
 * a `color-scheme` line rather than a second copy of the palette. This used to
 * brace-match the media query and treat every `oklch()` outside it as a light
 * value; now the pair *is* the source of both themes, which is the simpler
 * reading the review predicted.
 *
 * The danger of this shape is the opposite of the old one: a parse that quietly
 * returned the same half twice would still produce two passing themes and check
 * nothing. `both halves are really different` below is the guard against that,
 * and `no token escapes the pair` is the guard against a token being added
 * later in the old single-value style and being silently read as both.
 */
function tokenPairs(source: string): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const re = /(--[a-z0-9-]+):\s*light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Later declarations win, which is how the cascade would resolve them.
    light[m[1]!] = m[2]!;
    dark[m[1]!] = m[3]!;
  }
  return { light, dark };
}

/** A colour token declared as a single value, which `light-dark()` would skip. */
function unpairedTokens(source: string): string[] {
  return [...source.matchAll(/(--[a-z0-9-]+):\s*oklch\([^)]*\)\s*;/gi)].map((m) => m[1]!);
}

const { light, dark } = tokenPairs(css);

const THEMES: [string, Record<string, string>][] = [
  ['light', light],
  ['dark', dark],
];

describe('the colour maths itself', () => {
  it('converts oklch to sRGB within a rounding error of the known values', () => {
    const white = oklchToSrgb(1, 0, 0);
    expect(white.r).toBeCloseTo(1, 2);
    expect(white.g).toBeCloseTo(1, 2);
    expect(white.b).toBeCloseTo(1, 2);

    const black = oklchToSrgb(0, 0, 0);
    expect(black.r).toBeCloseTo(0, 2);
  });

  it('gives 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio(oklchToSrgb(0, 0, 0), oklchToSrgb(1, 0, 0))).toBeCloseTo(21, 0);
    const grey = oklchToSrgb(0.5, 0, 0);
    expect(contrastRatio(grey, grey)).toBeCloseTo(1, 5);
  });

  it('parses both percentage and unit lightness', () => {
    expect(parseOklch('oklch(52% 0.13 258)')).toEqual({ l: 0.52, c: 0.13, h: 258 });
    expect(parseOklch('oklch(0.52 0.13 258)')).toEqual({ l: 0.52, c: 0.13, h: 258 });
    expect(parseOklch('#fff')).toBeNull();
  });
});

describe('both themes define every token', () => {
  const REQUIRED = [
    '--bg', '--bg-raised', '--bg-sunken', '--bg-hover',
    '--text', '--text-muted', '--text-faint',
    '--line', '--line-strong', '--accent', '--accent-text', '--danger',
  ];

  it.each(THEMES)('%s', (_name, tokens) => {
    for (const key of REQUIRED) expect(tokens).toHaveProperty(key);
  });

  it('declares exactly the same token names in each', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });
});

/**
 * The guard on the merge itself.
 *
 * Everything below measures `light` against `light` and `dark` against `dark`.
 * If the parse ever returned the same half twice — a regex that dropped the
 * second argument, a token written with one value instead of a pair — every
 * ratio would still be computed and every assertion would still pass, while the
 * suite silently checked one theme twice. That is worse than having no contrast
 * test, because it reads as coverage. These two are what make the rest mean
 * something.
 */
describe('the two themes are really two themes', () => {
  it('found a pair for every token', () => {
    expect(Object.keys(light).length).toBeGreaterThan(40);
  });

  it('both halves are really different', () => {
    const same = Object.keys(light).filter((k) => light[k] === dark[k]);
    expect(same, 'tokens whose light and dark values are identical').toEqual([]);
  });

  it('no token escapes the pair into a single value', () => {
    // A `--x: oklch(...)` added later would be invisible to `tokenPairs` and so
    // would be checked in neither theme.
    expect(unpairedTokens(css)).toEqual([]);
  });

  it('the manual override pins color-scheme rather than redeclaring the palette', () => {
    expect(css).toContain("[data-theme='light'] { color-scheme: only light; }");
    expect(css).toContain("[data-theme='dark']  { color-scheme: only dark; }");
    // The old shape is gone: no media query may redeclare a colour token, or
    // the override would not reach it. Checked against the stylesheet with its
    // comments stripped, because the comment above the merged tokens names the
    // media query it replaced.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain(
      '@media (prefers-color-scheme: dark)',
    );
  });
});

describe('body text is comfortably readable', () => {
  it.each(THEMES)('%s: --text on every background clears 4.5:1', (_name, t) => {
    for (const bg of ['--bg', '--bg-raised', '--bg-sunken', '--bg-hover']) {
      const ratio = contrastOfOklch(t['--text']!, t[bg]!);
      expect(ratio, `--text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('%s: --text-muted clears 4.5:1 on the two common surfaces', (_name, t) => {
    for (const bg of ['--bg', '--bg-raised']) {
      const ratio = contrastOfOklch(t['--text-muted']!, t[bg]!);
      expect(ratio, `--text-muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('secondary text', () => {
  // --text-faint carries counts, timestamps and hints: never the only copy of
  // a fact, but it still has to be readable. 3:1 is the floor.
  it.each(THEMES)('%s: --text-faint clears 3:1', (_name, t) => {
    for (const bg of ['--bg', '--bg-raised', '--bg-sunken']) {
      const ratio = contrastOfOklch(t['--text-faint']!, t[bg]!);
      expect(ratio, `--text-faint on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('interactive and alarming colours', () => {
  it.each(THEMES)('%s: --accent-text on --accent clears 4.5:1', (_name, t) => {
    expect(contrastOfOklch(t['--accent-text']!, t['--accent']!)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The pressed states, which are the ones nobody looks at.
   *
   * A hover or an active fill is a colour a person reads text on for a fraction
   * of a second, which is exactly how a button ends up unreadable at the moment
   * it is being used. Both steps move away from the surface in their own theme —
   * darker in light, lighter in dark — so these ratios should be *higher* than
   * the resting one, and this fails if a later tweak inverts that.
   */
  it.each(THEMES)('%s: --accent-text stays readable on the hover and pressed fills', (_name, t) => {
    const resting = contrastOfOklch(t['--accent-text']!, t['--accent']!);
    for (const state of ['--accent-hover', '--accent-pressed'] as const) {
      expect(contrastOfOklch(t['--accent-text']!, t[state]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrastOfOklch(t['--accent-text']!, t[state]!)).toBeGreaterThanOrEqual(resting);
    }
  });

  it.each(THEMES)('%s: body text clears 4.5:1 on a pressed button', (_name, t) => {
    expect(contrastOfOklch(t['--text']!, t['--bg-pressed']!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: a pressed button is visibly darker than a hovered row', (_name, t) => {
    // The whole point of a separate token: if these two ever converge, pressing
    // a button looks the same as hovering it.
    expect(t['--bg-pressed']).not.toEqual(t['--bg-hover']);
    expect(contrastOfOklch(t['--bg-pressed']!, t['--bg-hover']!)).toBeGreaterThan(1.1);
  });

  it.each(THEMES)('%s: --accent as a link colour clears 4.5:1 on --bg', (_name, t) => {
    expect(contrastOfOklch(t['--accent']!, t['--bg']!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: --danger clears 4.5:1 on --bg and --bg-raised', (_name, t) => {
    expect(contrastOfOklch(t['--danger']!, t['--bg']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOfOklch(t['--danger']!, t['--bg-raised']!)).toBeGreaterThanOrEqual(4.5);
  });
});

const CATEGORY_COLOURS = [
  'emerald', 'amber', 'rose', 'violet', 'sky', 'lime', 'orange', 'fuchsia', 'indigo', 'slate',
];

describe('category and space colours', () => {
  it('defines a foreground and a chip fill for each, in both themes', () => {
    for (const name of CATEGORY_COLOURS) {
      for (const [themeName, t] of THEMES) {
        expect(t, `--c-${name} in ${themeName}`).toHaveProperty(`--c-${name}`);
        expect(t, `--c-${name}-bg in ${themeName}`).toHaveProperty(`--c-${name}-bg`);
      }
    }
  });

  it.each(THEMES)(
    '%s: every chip label clears 4.5:1 against its own fill',
    (_name, t) => {
      for (const name of CATEGORY_COLOURS) {
        const ratio = contrastOfOklch(t[`--c-${name}`]!, t[`--c-${name}-bg`]!);
        expect(ratio, `--c-${name} on --c-${name}-bg`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(THEMES)(
    '%s: a category label on the page background clears 4.5:1',
    (_name, t) => {
      // CategoryChip has no fill — the colour sits directly on the row.
      for (const name of CATEGORY_COLOURS) {
        const ratio = contrastOfOklch(t[`--c-${name}`]!, t['--bg']!);
        expect(ratio, `--c-${name} on --bg`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(THEMES)('%s: the chip fill is distinguishable from the page', (_name, t) => {
    // Not a WCAG rule — a chip whose fill matches the page has lost its shape,
    // and the space indicator has to be findable at a glance.
    for (const name of CATEGORY_COLOURS) {
      const ratio = contrastOfOklch(t[`--c-${name}-bg`]!, t['--bg']!);
      expect(ratio, `--c-${name}-bg vs --bg`).toBeGreaterThan(1.05);
    }
  });
});

describe('hairlines', () => {
  it.each(THEMES)('%s: --line is visible against --bg without shouting', (_name, t) => {
    const ratio = contrastOfOklch(t['--line']!, t['--bg']!);
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(6);
  });
});
