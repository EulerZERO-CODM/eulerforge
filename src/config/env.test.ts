import { describe, expect, it } from 'vitest';

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
