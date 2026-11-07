/**
 * Field readers for request bodies.
 *
 * `readJsonBody` returns `unknown`; these helpers turn that into strings and numbers with bounds,
 * and return `null` for anything absent or of the wrong type. Handlers then answer 422 once with the
 * list of problems, instead of throwing on a malformed body.
 */

export function readString(body: unknown, key: string, maxLength = 400): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  if (value.length > maxLength) return value.slice(0, maxLength);
  return value;
}

export function readBoolean(body: unknown, key: string): boolean | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

export function readNumber(body: unknown, key: string): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Integer or `null` (a new document), or `undefined` when the field is absent or unusable. */
export function readRevision(body: unknown, key: string): number | null | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return undefined;
}

export function readValue(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[key];
}
