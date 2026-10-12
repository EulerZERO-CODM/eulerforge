/**
 * A small `Result` type used by the platform's boundary code (storage adapters, export pipelines,
 * catalogue queries) so that recoverable failures are values instead of exceptions.
 *
 * Throwing remains appropriate for programmer errors and for unrecoverable start-up problems such
 * as invalid environment configuration.
 */

export type Result<TValue, TError = ForgeError> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: TError };

export type ForgeError = {
  readonly code: ForgeErrorCode;
  /** Human-readable, safe to show to a user. */
  readonly message: string;
  /** Optional developer-facing context; never contains user content in Phase 1. */
  readonly detail?: string;
  /** Whether retrying the same operation could plausibly succeed. */
  readonly retryable: boolean;
};

export type ForgeErrorCode =
  | 'storage-unavailable'
  | 'storage-quota-exceeded'
  | 'storage-corrupt'
  | 'not-found'
  | 'validation-failed'
  | 'unsupported'
  | 'unknown';

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError = ForgeError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

export function forgeError(
  code: ForgeErrorCode,
  message: string,
  options: { detail?: string | undefined; retryable?: boolean } = {},
): ForgeError {
  const base = { code, message, retryable: options.retryable ?? false };
  return options.detail === undefined ? base : { ...base, detail: options.detail };
}

/** Narrows a `Result` without a type assertion at every call site. */
export function isOk<TValue, TError>(
  result: Result<TValue, TError>,
): result is { readonly ok: true; readonly value: TValue } {
  return result.ok;
}

/** Human-readable message for any thrown value. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}
