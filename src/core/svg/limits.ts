/**
 * Import limits.
 *
 * An SVG file is untrusted input. These bounds are checked before or during parsing so a hostile or
 * merely careless file fails quickly and explains itself, instead of leaving the tab unresponsive.
 * They are deliberately far above any hand-authored icon or illustration.
 */
export const SVG_LIMITS = Object.freeze({
  /** 2 MB of markup: an order of magnitude beyond a hand-drawn illustration. */
  maxBytes: 2 * 1024 * 1024,
  /** Total elements walked, including groups. */
  maxElements: 20_000,
  /** Drawable shapes imported in one file. */
  maxShapes: 2_000,
  /** Nesting depth; deeper trees are skipped with a report rather than being walked. */
  maxDepth: 60,
});
