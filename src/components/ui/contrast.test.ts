import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrast guarantees for the design tokens.
 *
 * The interface is a dark-theme creative tool, so "it looked fine on my monitor" is not a good
 * enough standard for text legibility. This test reads the *real* token declarations from
 * `src/app/globals.css`, converts them from OKLCH to sRGB, and measures WCAG contrast for the
 * foreground/background pairs the components actually use. Editing a colour token therefore
 * re-measures every pairing below — a token can no longer be silently darkened into unreadability.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Declarations of the form `--color-name: value;` at the top level of the file. */
function readColourTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const pattern = /--color-([a-z0-9-]+):\s*([^;]+);/g;
  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    const value = match[2];
    if (!name || !value) continue;
    tokens[`--color-${name}`] = value.trim();
  }
  return tokens;
}

const TOKENS = readColourTokens(CSS);

/** Follows `var(--color-…)` aliases down to a literal OKLCH value. */
function resolveToken(name: string): string {
  const value = TOKENS[name];
  if (!value) throw new Error(`Token ${name} is not declared in globals.css`);
  const alias = /var\(\s*(--color-[a-z0-9-]+)\s*\)/.exec(value);
  if (alias) {
    const target = alias[1];
    if (!target) throw new Error(`Token ${name} has an unreadable alias`);
    return resolveToken(target);
  }
  return value;
}

type Rgb = readonly [number, number, number];

/** OKLCH -> linear sRGB -> gamma-encoded sRGB, per the CSS Color 4 conversions. */
function oklchToSrgb(value: string): Rgb {
  const match = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(value);
  if (!match) throw new Error(`Unsupported colour value "${value}" — expected oklch(L% C H)`);

  const lightness = Number(match[1]) / 100;
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const encode = (channel: number): number => {
    const clamped = Math.min(1, Math.max(0, channel));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  };

  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function relativeLuminance(colour: Rgb): number {
  const linear = colour.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(oklchToSrgb(resolveToken(foreground)));
  const b = relativeLuminance(oklchToSrgb(resolveToken(background)));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairings that carry text. WCAG AA for normal-size text is 4.5:1. */
const TEXT_PAIRS: readonly (readonly [string, string, string])[] = [
  ['--color-fg', '--color-canvas', 'body text on the page background'],
  ['--color-fg', '--color-surface', 'panel text'],
  ['--color-fg', '--color-surface-raised', 'card text'],
  ['--color-fg', '--color-surface-overlay', 'text in dialogs and menus'],
  ['--color-fg-muted', '--color-canvas', 'secondary copy'],
  ['--color-fg-muted', '--color-surface', 'secondary copy in panels'],
  ['--color-fg-muted', '--color-surface-raised', 'secondary copy on cards'],
  ['--color-fg-subtle', '--color-surface', 'hints and field descriptions'],
  ['--color-fg-subtle', '--color-surface-raised', 'hints on cards'],
  ['--color-fg-inverse', '--color-accent', 'primary button label'],
  ['--color-fg-inverse', '--color-accent-hover', 'primary button label, hover'],
  ['--color-ember-400', '--color-surface', 'accent text'],
  ['--color-arc-400', '--color-surface', 'links and informational text'],
  ['--color-mint-400', '--color-surface-raised', 'success text'],
  ['--color-amber-400', '--color-surface-raised', 'warning text'],
  ['--color-rose-400', '--color-surface-raised', 'danger text'],
  ['--color-violet-400', '--color-surface-raised', 'planned badge text'],
];

/** Studio accents sit on the overlay surface used by cards and glyphs. */
const STUDIO_ACCENT_PAIRS = [
  '--color-cobalt-400',
  '--color-ember-400',
  '--color-plum-400',
  '--color-teal-400',
  '--color-violet-400',
] as const;

describe('design token contrast', () => {
  it('measures every text pairing at or above the WCAG AA threshold', () => {
    for (const [foreground, background, description] of TEXT_PAIRS) {
      const ratio = contrastRatio(foreground, background);
      expect(
        ratio,
        `${description}: ${foreground} on ${background} was ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every studio accent readable on the overlay surface', () => {
    for (const accent of STUDIO_ACCENT_PAIRS) {
      const ratio = contrastRatio(accent, '--color-surface-overlay');
      expect(ratio, `${accent} was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('shows a focus ring that differs enough from both the canvas and raised surfaces', () => {
    for (const surface of ['--color-canvas', '--color-surface-raised']) {
      const ratio = contrastRatio('--color-focus', surface);
      expect(ratio, `focus on ${surface} was ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps hairline separators visible without competing with content', () => {
    const line = contrastRatio('--color-line', '--color-surface');
    const strong = contrastRatio('--color-line-strong', '--color-surface-raised');

    // Decorative separators are intentionally quiet, but must not vanish entirely.
    expect(line).toBeGreaterThan(1.15);
    expect(strong).toBeGreaterThan(1.3);
    expect(strong).toBeLessThan(4.5);
  });

  it('resolves every token it measures, so a rename cannot silently skip a check', () => {
    const names = [
      ...TEXT_PAIRS.flatMap(([foreground, background]) => [foreground, background]),
      ...STUDIO_ACCENT_PAIRS,
      '--color-focus',
      '--color-line',
      '--color-line-strong',
    ];

    for (const name of names) {
      expect(() => resolveToken(name), name).not.toThrow();
      expect(resolveToken(name), name).toMatch(/^oklch\(/);
    }
  });
});
