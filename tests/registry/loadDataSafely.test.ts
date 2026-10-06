import { describe, expect, it } from 'vitest';
import { loadDataSafely } from '../../src/registry/loadDataSafely.js';

// A recorder for quarantine calls, so a test can prove a corrupt file was moved
// aside rather than silently reset.
function quarantineSpy() {
  let calls = 0;
  return {
    quarantine: async () => {
      calls += 1;
    },
    calls: () => calls,
  };
}

describe('loadDataSafely', () => {
  it('returns a parsed object root unchanged', async () => {
    const spy = quarantineSpy();
    const root = { githubToken: 'x', syncState: { version: 3 } };
    expect(await loadDataSafely(async () => root, spy.quarantine)).toBe(root);
    expect(spy.calls()).toBe(0);
  });

  it('starts empty for a missing file without quarantining', async () => {
    // Given — no data.json yet (loadData returns null)
    const spy = quarantineSpy();

    // When — the root is loaded

    // Then — there is nothing to lose, so nothing is quarantined
    expect(await loadDataSafely(async () => null, spy.quarantine)).toEqual({});
    expect(spy.calls()).toBe(0);
  });

  it('quarantines a null read when the file exists on disk', async () => {
    // Given — Obsidian returns null, but data.json is present (a parse failure
    // that surfaced as null rather than a throw)
    const spy = quarantineSpy();

    // When — the root is loaded

    // Then — the existing file is moved aside rather than silently reset
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
    // Given — a data.json that exists but throws on parse
    const spy = quarantineSpy();

    // When — the root is loaded

    // Then — the file is moved aside before starting empty
    expect(
      await loadDataSafely(async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      }, spy.quarantine),
    ).toEqual({});
    expect(spy.calls()).toBe(1);
  });

  it('quarantines a non-object root instead of silently resetting it', async () => {
    // Given — a data.json whose root parsed to a scalar
    const spy = quarantineSpy();

    // When — the root is loaded

    // Then — it is structurally corrupt and is moved aside
    expect(
      await loadDataSafely(async () => 'not-an-object', spy.quarantine),
    ).toEqual({});
    expect(spy.calls()).toBe(1);
  });

  it('propagates a failed quarantine so a corrupt file is never overwritten', async () => {
    // Given — a corrupt file whose rename-aside fails
    const failing = async () => {
      throw new Error('rename failed');
    };

    // When — the root is loaded

    // Then — the failure surfaces rather than starting empty over the file
    await expect(
      loadDataSafely(async () => {
        throw new SyntaxError('corrupt');
      }, failing),
    ).rejects.toThrow('rename failed');
  });
});
