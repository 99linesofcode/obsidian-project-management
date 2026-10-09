import { describe, expect, it } from 'vitest';
import { hash } from '../../src/core/hash.js';

describe('SYNC-6 — the canonical digest is stable', () => {
  it('is deterministic for the same input', () => {
    const first = hash('The bug happens when the widget is resized.');
    const second = hash('The bug happens when the widget is resized.');

    expect(second).toBe(first);
  });

  it('produces distinct hashes for distinct inputs', () => {
    const first = hash('The bug happens when the widget is resized.');
    const second = hash('The widget is resized and the bug happens.');

    expect(second).not.toBe(first);
  });

  it('matches the FNV-1a 64-bit known-answer vectors', () => {
    expect(hash('')).toBe('cbf29ce484222325');
    expect(hash('a')).toBe('af63dc4c8601ec8c');
    expect(hash('foobar')).toBe('85944171f73967e8');
  });

  it('always renders a normalized 16-hex-character digest', () => {
    const digests = ['', 'a', 'foobar', 'The bug happens on resize.'].map(
      (input) => hash(input),
    );

    for (const digest of digests) {
      expect(digest).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
