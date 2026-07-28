/**
 * Colour maths, so contrast is checked rather than asserted.
 *
 * Every token in globals.css is an oklch() triple. oklch is the right space to
 * *choose* colours in — equal L steps look equal — but WCAG contrast is defined
 * on sRGB relative luminance, and the two do not agree. A pair that looks like
 * a comfortable step in oklch can still fail 4.5:1. So: convert, then measure.
 *
 * Used only by the test suite and by anyone adding a token; nothing at runtime
 * needs it.
 */

export type Rgb = { r: number; g: number; b: number }; // 0–1, sRGB, gamma-encoded

/** Parse `oklch(52% 0.13 258)` or `oklch(0.52 0.13 258)`. */
export function parseOklch(css: string): { l: number; c: number; h: number } | null {
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)/i.exec(css);
  if (!m) return null;
  const raw = Number(m[1]);
  return {
    l: m[2] === '%' ? raw / 100 : raw,
    c: Number(m[3]),
    h: Number(m[4]),
  };
}

export function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);

  // Oklab -> LMS
  const l_ = l + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = l - 0.0894841775 * a - 1.291485548 * bb;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  // LMS -> linear sRGB
  const lr = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const lb = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;

  return { r: encode(lr), g: encode(lg), b: encode(lb) };
}

function encode(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
  return clamp01(v);
}

function decode(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastOfOklch(fg: string, bg: string): number {
  const f = parseOklch(fg);
  const b = parseOklch(bg);
  if (!f || !b) throw new Error(`Not an oklch colour: ${!f ? fg : bg}`);
  return contrastRatio(oklchToSrgb(f.l, f.c, f.h), oklchToSrgb(b.l, b.c, b.h));
}
