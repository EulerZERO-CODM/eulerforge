export type ClassValue = string | false | null | undefined;

/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately not `clsx` + `tailwind-merge`: component variants are written so that a caller's
 * `className` is appended last and never conflicts with the variant's own layout classes. If that
 * discipline ever breaks, this is the single place to upgrade (see docs/DECISIONS.md → ADR-0003).
 */
export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}
