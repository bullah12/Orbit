import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Class names the stylesheet claims, and Tailwind also claims.
 *
 * `globals.css` defines `.block` in `@layer utilities` — an agenda block:
 * flex column, padding, a hairline and a 3px category edge. Tailwind defines
 * `.block` in the same layer as `display: block`. The stylesheet is emitted
 * after the framework, so it wins, and every `className="block"` in the app
 * silently becomes an agenda block: white fill, 8px of padding and a coloured
 * left border on what was meant to be a plain wrapper.
 *
 * That is not hypothetical — it happened to eight compose surfaces and three
 * list links the moment the new stylesheet landed. The fix is to never use
 * Tailwind's bare `block` utility in this codebase: `flex` covers the wrappers,
 * and `[display:block]` covers the cases that genuinely need the display value.
 *
 * This test is the guard, because the failure is invisible in review — the
 * markup looks completely ordinary.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SRC).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

/** Every class name mentioned in a className string literal, with its context. */
function classNamesIn(source: string): { cls: string; value: string; line: number }[] {
  const out: { cls: string; value: string; line: number }[] = [];
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
      const value = m[1] ?? m[2] ?? m[3] ?? '';
      for (const cls of value.split(/\s+/)) {
        if (cls) out.push({ cls, value, line: i + 1 });
      }
    }
  });
  return out;
}

describe('utility names the stylesheet has taken over', () => {
  // `.block` is the agenda block. Tailwind's display utility of the same name
  // loses the cascade to it, so using it renders a bordered, padded card.
  it('never uses Tailwind’s bare `block` utility', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const { cls, value, line } of classNamesIn(source)) {
        if (cls !== 'block') continue;
        // An agenda block is the one thing entitled to this name, and it is
        // recognisable because it carries one of the stylesheet's own `block-*`
        // modifiers alongside it. Everything else meant Tailwind's display
        // utility and is getting a bordered card instead.
        if (/\bblock-(now|time)\b/.test(value)) continue;
        offenders.push(`${file.replace(SRC, 'src')}:${line}`);
      }
    }
    expect(
      offenders,
      'use `flex` for wrappers, or `[display:block]` where the display value is needed; ' +
        'a real agenda block should carry `block-now`/`block-time` with it',
    ).toEqual([]);
  });

  // The same trap, one step removed: these are the other names globals.css
  // defines that a person might reasonably expect to be Tailwind's.
  it('documents the other names globals.css claims', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../src/app/globals.css', import.meta.url)),
      'utf8',
    );
    const claimed = [...css.matchAll(/^\s{2}\.([a-z-]+)\s*\{/gm)].map((m) => m[1]!);
    // If this ever grows a name Tailwind also ships, the collision above is
    // waiting to happen again with a different class.
    expect(claimed).toContain('block');
    expect(claimed).toContain('row');
    expect(claimed).toContain('map');
  });
});
