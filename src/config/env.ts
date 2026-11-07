/**
 * Runtime-validated environment configuration.
 *
 * Every `NEXT_PUBLIC_*` reference is written out literally so that the Next.js compiler can
 * statically inline it into the client bundle.
 *
 * Invalid configuration throws immediately with a readable message rather than silently
 * falling back to a default — see docs/DECISIONS.md → ADR-0011.
 */
import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_FORGE_SITE_URL: z
    .url({ error: 'must be an absolute http(s) URL, e.g. https://forge.example.com' })
    // `z.url()` accepts any scheme (`new URL('mailto:x')` parses), so the http(s) restriction the
    // message promises has to be enforced explicitly.
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      'must use the http or https scheme',
    )
    .default('http://localhost:3000'),
  NEXT_PUBLIC_FORGE_CATALOG_SOURCE: z.enum(['sample', 'empty']).default('sample'),
  NEXT_PUBLIC_FORGE_TELEMETRY: z
    .enum(['off'])
    .default('off')
    .describe('Telemetry cannot be enabled in Phase 1; no adapter exists.'),
  NEXT_PUBLIC_FORGE_ENVIRONMENT: z
    .enum(['development', 'preview', 'production'])
    .default('development'),
});

export type PublicEnv = {
  /** Absolute origin the app is served from. */
  readonly siteUrl: string;
  /** Which asset catalogue adapter to use. */
  readonly catalogSource: 'sample' | 'empty';
  /** Telemetry flag. `off` is the only accepted value in Phase 1. */
  readonly telemetry: 'off';
  /** Informational environment label, surfaced in the UI footer and diagnostics. */
  readonly environment: 'development' | 'preview' | 'production';
};

/** Thrown when one or more environment variables fail validation. */
export class EnvironmentValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(
      [
        "Euler's Forge refused to start: invalid environment configuration.",
        ...issues.map((issue) => `  • ${issue}`),
        '',
        'Compare your .env.local against .env.example.',
      ].join('\n'),
    );
    this.name = 'EnvironmentValidationError';
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `${key}: ${issue.message}`;
  });
}

/**
 * Parses and freezes the public environment.
 * @throws {EnvironmentValidationError} when a value is present but invalid.
 */
export function parsePublicEnv(
  source: Record<string, string | undefined> = process.env,
): PublicEnv {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_FORGE_SITE_URL: source.NEXT_PUBLIC_FORGE_SITE_URL,
    NEXT_PUBLIC_FORGE_CATALOG_SOURCE: source.NEXT_PUBLIC_FORGE_CATALOG_SOURCE,
    NEXT_PUBLIC_FORGE_TELEMETRY: source.NEXT_PUBLIC_FORGE_TELEMETRY,
    NEXT_PUBLIC_FORGE_ENVIRONMENT: source.NEXT_PUBLIC_FORGE_ENVIRONMENT,
  });

  if (!parsed.success) {
    throw new EnvironmentValidationError(formatIssues(parsed.error));
  }

  const value = parsed.data;
  return Object.freeze({
    siteUrl: value.NEXT_PUBLIC_FORGE_SITE_URL,
    catalogSource: value.NEXT_PUBLIC_FORGE_CATALOG_SOURCE,
    telemetry: value.NEXT_PUBLIC_FORGE_TELEMETRY,
    environment: value.NEXT_PUBLIC_FORGE_ENVIRONMENT,
  });
}

/**
 * The `NEXT_PUBLIC_*` values, read through literal member expressions.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_X` in a client bundle by rewriting that exact member
 * expression at build time. Passing `process.env` *as a value* (`parsePublicEnv(process.env)`)
 * defeats that rewrite: the compiler cannot see which variables are wanted, so the browser gets a
 * runtime `process.env` shim that contains none of them and every setting silently falls back to its
 * default. That is how a preview build rendered `v0.1.0 · development` in the browser while the
 * server rendered `v0.1.0 · preview` — a hydration mismatch on every page, invisible in CI because
 * CI sets none of these variables and both sides then agreed on the default.
 *
 * These four lines are therefore load-bearing and must stay literal. `parsePublicEnv` keeps taking
 * an explicit source so tests can validate arbitrary input.
 */
const buildTimeEnv: Record<string, string | undefined> = {
  NEXT_PUBLIC_FORGE_SITE_URL: process.env.NEXT_PUBLIC_FORGE_SITE_URL,
  NEXT_PUBLIC_FORGE_CATALOG_SOURCE: process.env.NEXT_PUBLIC_FORGE_CATALOG_SOURCE,
  NEXT_PUBLIC_FORGE_TELEMETRY: process.env.NEXT_PUBLIC_FORGE_TELEMETRY,
  NEXT_PUBLIC_FORGE_ENVIRONMENT: process.env.NEXT_PUBLIC_FORGE_ENVIRONMENT,
};

export const env: PublicEnv = parsePublicEnv(buildTimeEnv);
