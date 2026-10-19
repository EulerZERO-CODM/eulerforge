// @vitest-environment node
/**
 * Deployment-safety of the optional server's storage.
 *
 * The file store is a single-process design. On a serverless platform the filesystem is ephemeral,
 * so "saved" would mean "saved until this instance is recycled" — a promise the product must not
 * make. These tests pin the refusal and the escape hatch, without needing a deployment.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getStore,
  serverDataDir,
  serverlessStorageProblem,
  setServerDataDirForTests,
} from './runtime';

afterEach(() => {
  setServerDataDirForTests(null);
});

describe('serverlessStorageProblem', () => {
  it('stays silent on a normal host', () => {
    expect(serverlessStorageProblem({})).toBeNull();
  });

  it('refuses a serverless host that has no configured durable directory', () => {
    const problem = serverlessStorageProblem({ VERCEL: '1' });
    expect(problem).toMatch(/not persistent/i);
    expect(problem).toMatch(/FORGE_DATA_DIR/);
    // The sentence has to point at what still works, or a preview user reads it as "the app is broken".
    expect(problem).toMatch(/stays in this browser/i);
    expect(serverlessStorageProblem({ AWS_LAMBDA_FUNCTION_NAME: 'fn' })).not.toBeNull();
  });

  it('accepts an explicit data directory, because the operator has said where durability lives', () => {
    expect(serverlessStorageProblem({ VERCEL: '1', FORGE_DATA_DIR: '/mnt/forge' })).toBeNull();
    expect(serverlessStorageProblem({ VERCEL: '1', FORGE_DATA_DIR: '   ' })).not.toBeNull();
  });
});

describe('getStore on a serverless host', () => {
  it('answers unavailable instead of writing to an ephemeral filesystem', async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    delete process.env.FORGE_DATA_DIR;
    setServerDataDirForTests(null);
    try {
      const store = await getStore();
      expect(store.ok).toBe(false);
      if (store.ok) return;
      expect(store.error.kind).toBe('unavailable');
      expect(store.error.message).toMatch(/not persistent/i);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });

  it('still opens a store when a test (or an operator) supplies a real directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'forge-runtime-'));
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      setServerDataDirForTests(directory);
      const store = await getStore();
      expect(store.ok).toBe(true);
      if (store.ok) expect(serverDataDir()).toBe(directory);
    } finally {
      setServerDataDirForTests(null);
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
