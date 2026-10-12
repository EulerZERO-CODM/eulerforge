/**
 * Branded identifier helpers.
 *
 * Domain identifiers are `string` at runtime but nominally distinct at the type level, so that a
 * project id cannot be passed where a studio id is expected. The only sanctioned way to create a
 * branded value is a validating schema (see `src/core/documents/schema.ts`) or the helper below,
 * which is used inside those schemas.
 */

declare const brandSymbol: unique symbol;

/** A string with a compile-time-only brand. */
export type Branded<TBase, TName extends string> = TBase & { readonly [brandSymbol]: TName };

/** Casts an already-validated string to a branded id. */
export function brand<TName extends string>(value: string): Branded<string, TName> {
  return value as Branded<string, TName>;
}
