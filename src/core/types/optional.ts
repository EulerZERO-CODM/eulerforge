/**
 * Optional-property helpers.
 *
 * The project enables `exactOptionalPropertyTypes`, which distinguishes "property absent" from
 * "property present but undefined". Domain input types need the second form because validated
 * payloads (and object spreads) legitimately carry explicit `undefined`, so the helpers below make
 * that intent explicit rather than weakening the compiler setting everywhere.
 */

export type Undefinable<T> = T | undefined;

/** Same keys as `T`, but every property may be omitted or explicitly `undefined`. */
export type PartialProps<T> = { [TKey in keyof T]?: T[TKey] | undefined };
