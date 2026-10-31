import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { EnvironmentValidationError, parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('applies documented defaults when nothing is configured', () => {
    const env = parsePublicEnv({});
    expect(env).toEqual({
      siteUrl: 'http://localhost:3000',
      catalogSource: 'sample',
      telemetry: 'off',
      environment: 'development',
    });
  });

  it('reads configured values', () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_FORGE_SITE_URL: 'https://forge.example.com',
      NEXT_PUBLIC_FORGE_CATALOG_SOURCE: 'empty',
      NEXT_PUBLIC_FORGE_TELEMETRY: 'off',
      NEXT_PUBLIC_FORGE_ENVIRONMENT: 'production',
    });

    expect(env.siteUrl).toBe('https://forge.example.com');
    expect(env.catalogSource).toBe('empty');
    expect(env.environment).toBe('production');
  });

  it('returns a frozen object so configuration cannot be mutated at runtime', () => {
    expect(Object.isFrozen(parsePublicEnv({}))).toBe(true);
  });

  it('throws for a site URL that is not an absolute URL', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_FORGE_SITE_URL: 'localhost:3000' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('names the offending variable and keeps the message actionable', () => {
    try {
      parsePublicEnv({ NEXT_PUBLIC_FORGE_CATALOG_SOURCE: 'remote' });
      throw new Error('expected the parse to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      if (!(error instanceof EnvironmentValidationError)) return;
      expect(error.issues.join('\n')).toMatch(/NEXT_PUBLIC_FORGE_CATALOG_SOURCE/);
      expect(error.message).toMatch(/\.env\.example/);
    }
  });

  it('rejects telemetry values other than off', () => {
    // There is no telemetry adapter in Phase 1: enabling it must fail loudly, not silently no-op.
    expect(() => parsePublicEnv({ NEXT_PUBLIC_FORGE_TELEMETRY: 'on' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('rejects an unknown environment label', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_FORGE_ENVIRONMENT: 'staging' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('collects every problem into a single error', () => {
    try {
      parsePublicEnv({
        NEXT_PUBLIC_FORGE_SITE_URL: 'not-a-url',
        NEXT_PUBLIC_FORGE_CATALOG_SOURCE: 'remote',
      });
      throw new Error('expected the parse to fail');
    } catch (error) {
      if (!(error instanceof EnvironmentValidationError)) throw error;
      const report = error.issues.join('\n');
      expect(report).toMatch(/NEXT_PUBLIC_FORGE_SITE_URL/);
      expect(report).toMatch(/NEXT_PUBLIC_FORGE_CATALOG_SOURCE/);
      expect(error.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the exported environment', () => {
  const keys = [
    'NEXT_PUBLIC_FORGE_SITE_URL',
    'NEXT_PUBLIC_FORGE_CATALOG_SOURCE',
    'NEXT_PUBLIC_FORGE_TELEMETRY',
    'NEXT_PUBLIC_FORGE_ENVIRONMENT',
  ] as const;

  it('reflects the variables set at build time instead of falling back to defaults', async () => {
    // Regression: `parsePublicEnv(process.env)` passed the whole object as a *value*, so Next.js
    // could not inline the individual variables into the client bundle. The browser then saw none of
    // them and used the defaults, while the server used the real values — a hydration mismatch on
    // every page of a preview build, and a footer that named the wrong environment.
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_FORGE_ENVIRONMENT', 'preview');
    vi.stubEnv('NEXT_PUBLIC_FORGE_SITE_URL', 'https://forge.example.com');
    try {
      const { env } = await import('./env');
      expect(env.environment).toBe('preview');
      expect(env.siteUrl).toBe('https://forge.example.com');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('reads each public variable through a literal member expression, which is what Next inlines', async () => {
    // A source-level guard on the compiler contract: `process.env[someName]` and `parsePublicEnv(
    // process.env)` are both invisible to the inliner. This is the one assertion that would have
    // failed when the bug above was introduced.
    const source = await readFile('src/config/env.ts', 'utf8');
    for (const key of keys) expect(source).toContain(`process.env.${key}`);
  });
});
