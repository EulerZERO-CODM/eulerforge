/**
 * HTTP plumbing shared by the API route handlers.
 *
 * Everything here is deliberately explicit: status codes, cookie attributes, body limits, origin
 * checking and rate limiting are written down in one place instead of being implied by a framework
 * default. The handlers themselves stay small enough to read.
 */

import { SESSION_COOKIE } from './sessions';
import type { StoreError } from './store';

/**
 * The default request-body budget.
 *
 * Every JSON endpoint is small: a goal, a password, a share expiry. Documents are the exception —
 * a real photo project embeds its working copy — so the document route passes its own, larger
 * budget to `readJsonBody` instead of raising this one for the whole API.
 */
export const MAX_BODY_BYTES = 120 * 1024;

export type ApiFailure = {
  readonly error: {
    readonly kind: StoreError['kind'] | 'unauthenticated' | 'rate-limited' | 'bad-request';
    readonly message: string;
    readonly issues?: readonly string[];
    readonly serverRevision?: number;
    readonly updatedAt?: string;
  };
};

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE,
      ...init.headers,
    },
  });
}

export function failureResponse(
  status: number,
  kind: ApiFailure['error']['kind'],
  message: string,
  extra: { readonly issues?: readonly string[] } = {},
): Response {
  const error: ApiFailure['error'] = {
    kind,
    message,
    ...(extra.issues === undefined ? {} : { issues: extra.issues }),
  };
  return jsonResponse({ error } satisfies ApiFailure, { status });
}

export function statusForStoreError(error: StoreError): number {
  switch (error.kind) {
    case 'not-found':
      return 404;
    case 'conflict':
      return 409;
    case 'validation':
      return 422;
    case 'unavailable':
      return 503;
  }
}

export function storeErrorResponse(error: StoreError): Response {
  const base: ApiFailure['error'] = { kind: error.kind, message: error.message };
  if (error.kind === 'validation') {
    return jsonResponse({ error: { ...base, issues: error.issues } } satisfies ApiFailure, {
      status: 422,
    });
  }
  if (error.kind === 'conflict') {
    return jsonResponse(
      {
        error: {
          ...base,
          serverRevision: error.serverRevision,
          updatedAt: error.updatedAt,
        },
      } satisfies ApiFailure,
      { status: 409 },
    );
  }
  return jsonResponse({ error: base } satisfies ApiFailure, { status: statusForStoreError(error) });
}

export type BodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

/** Reads a JSON body, refusing anything above `maxBytes` or that is not an object. */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<BodyResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    return {
      ok: false,
      response: failureResponse(
        413,
        'bad-request',
        'That request is larger than this API accepts.',
      ),
    };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return {
      ok: false,
      response: failureResponse(400, 'bad-request', 'The body could not be read.'),
    };
  }
  if (text.length > maxBytes) {
    return {
      ok: false,
      response: failureResponse(
        413,
        'bad-request',
        'That request is larger than this API accepts.',
      ),
    };
  }
  if (text.trim().length === 0) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        response: failureResponse(400, 'bad-request', 'The body must be a JSON object.'),
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      response: failureResponse(400, 'bad-request', 'The body is not valid JSON.'),
    };
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const raw = part.slice(separator + 1).trim();
      // A cookie is client input. `decodeURIComponent` throws on a malformed escape (`%`, `%E0%A4`),
      // and that exception used to escape the route as a 500. An undecodable value cannot be a
      // session token — the alphabet has no `%` — so the raw value is returned and simply fails to
      // look like a token.
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== null) return forwarded.split(',')[0]?.trim() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const secure = isSecureRequest(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(maxAgeSeconds)}${secure}`;
}

export function clearedSessionCookie(request: Request): string {
  return sessionCookie(request, '', 0);
}

/**
 * Refuses a state-changing request whose `Origin` is not this server.
 *
 * Cookies are `SameSite=Lax`, so a cross-site form post does not carry them; this check is the
 * second lock, for browsers or proxies that are less careful. Requests without an `Origin` (curl,
 * tests, server-to-server) are allowed because they carry no ambient browser credentials.
 */
export function crossOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  // No Origin at all: curl, a test, or a server-to-server call. There are no ambient browser
  // credentials to abuse, so those are allowed.
  if (origin === null || origin === 'null') return false;

  // `request.url` is the address the server itself was given, which is not necessarily the address
  // the browser used (127.0.0.1 vs localhost, a proxy in front, a different port). The request's own
  // `Host` header — or a proxy's forwarded host — is the authority the browser actually asked for.
  let actual: URL;
  try {
    actual = new URL(request.url);
  } catch {
    return true;
  }
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? request.headers.get('host');
  if (forwardedProto) actual.protocol = `${forwardedProto}:`;
  if (host) actual.host = host;

  try {
    return new URL(origin).origin !== actual.origin;
  } catch {
    return true;
  }
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'local';
}

/* ------------------------------------------------------------------------------------------- */
/* Rate limiting                                                                              */
/* ------------------------------------------------------------------------------------------- */

type Bucket = { readonly hits: number[] };

/**
 * A fixed-window-ish limiter, in memory.
 *
 * It protects the password endpoints against a scripted guessing loop in a single-process
 * deployment. It is **not** a distributed defence: a restart clears it, and two instances would each
 * keep their own count. That is stated in `docs/ARCHITECTURE.md` rather than implied to be enough.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public check(key: string): { readonly allowed: boolean; readonly retryAfterMs: number } {
    const current = this.now();
    const bucket = this.buckets.get(key);
    const hits = (bucket?.hits ?? []).filter((time) => current - time < this.windowMs);
    if (hits.length >= this.limit) {
      const oldest = hits[0] ?? current;
      return { allowed: false, retryAfterMs: Math.max(0, this.windowMs - (current - oldest)) };
    }
    hits.push(current);
    this.buckets.set(key, { hits });
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Forgets one key: a successful sign-in should not spend a failure budget. */
  public clear(key: string): void {
    this.buckets.delete(key);
  }

  public reset(): void {
    this.buckets.clear();
  }
}

/** Ten failed attempts per ten minutes per client+email. */
export const loginLimiter = new RateLimiter(10, 10 * 60_000);
/** Five registrations per hour per client. */
export const registerLimiter = new RateLimiter(5, 60 * 60_000);

export function rateLimitedResponse(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new Response(
    JSON.stringify({
      error: {
        kind: 'rate-limited',
        message: `Too many attempts. Try again in ${String(seconds)} s.`,
      },
    } satisfies ApiFailure),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(seconds),
        ...NO_STORE,
      },
    },
  );
}
