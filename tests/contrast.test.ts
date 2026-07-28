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
 * Every `@media (prefers-color-scheme: dark)` region, by brace matching.
 *
 * The tokens are declared in several passes — base colours, then category
 * colours, each with its own dark override — so "everything after the first
 * media query is dark" is wrong. The ranges have to be found properly.
 */
function darkRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  const marker = '@media (prefers-color-scheme: dark)';
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) break;
    const open = source.indexOf('{', at);
    let depth = 0;
    let i = open;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    ranges.push([open, i]);
    from = i;
  }
  return ranges;
}

const DARK = darkRanges(css);

function tokensFor(theme: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[a-z0-9-]+):\s*(oklch\([^)]*\))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const inDark = DARK.some(([a, b]) => m!.index > a && m!.index < b);
    // Later declarations win, which is how the cascade would resolve them.
    if (theme === 'dark' ? inDark : !inDark) out[m[1]!] = m[2]!;
  }
  return out;
}

const light = tokensFor('light');
const dark = tokensFor('dark');

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
