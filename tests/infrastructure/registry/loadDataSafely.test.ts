import { describe, expect, it } from 'vitest';
import { loadDataSafely } from '../../../src/infrastructure/registry/loadDataSafely.js';

function quarantineSpy() {
  let calls = 0;
  return {
    quarantine: async () => {
      calls += 1;
    },
    calls: () => calls,
  };
}

describe('REG-4 — a crash during a write never resets the registry', () => {
  it('returns a parsed object root unchanged', async () => {
    const spy = quarantineSpy();
    const root = { githubToken: 'x', syncState: { version: 3 } };
    expect(await loadDataSafely(async () => root, spy.quarantine)).toBe(root);
    expect(spy.calls()).toBe(0);
  });

  it('starts empty for a missing file without quarantining', async () => {
    const spy = quarantineSpy();

    expect(await loadDataSafely(async () => null, spy.quarantine)).toEqual({});
    expect(spy.calls()).toBe(0);
  });

  it('quarantines a null read when the file exists on disk', async () => {
    const spy = quarantineSpy();

    expect(
      await loadDataSafely(
        async () => null,
        spy.quarantine,
        async () => true,
      ),
    ).toEqual({});
    expect(spy.calls()).toBe(1);
  });

  it('quarantines an unreadable file instead of silently resetting it', async () => {
    const spy = quarantineSpy();

    expect(
      await loadDataSafely(async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      }, spy.quarantine),
    ).toEqual({});
    expect(spy.calls()).toBe(1);
  });

  it('quarantines a non-object root instead of silently resetting it', async () => {
    const spy = quarantineSpy();

    expect(
      await loadDataSafely(async () => 'not-an-object', spy.quarantine),
    ).toEqual({});
    expect(spy.calls()).toBe(1);
  });

  it('propagates a failed quarantine so a corrupt file is never overwritten', async () => {
    const failing = async () => {
      throw new Error('rename failed');
    };

    await expect(
      loadDataSafely(async () => {
        throw new SyntaxError('corrupt');
      }, failing),
    ).rejects.toThrow('rename failed');
  });
});
