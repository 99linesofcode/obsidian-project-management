import { describe, expect, it } from 'vitest';
import { hash } from '../../../src/Domain/Notes/hash.js';

describe('hash', () => {
  it('is deterministic for the same input', () => {
    // Given — a body

    // When — it is hashed twice
    const first = hash('The bug happens when the widget is resized.');
    const second = hash('The bug happens when the widget is resized.');

    // Then — both hashes are identical
    expect(second).toBe(first);
  });

  it('produces distinct hashes for distinct inputs', () => {
    // Given — two different bodies

    // When — both are hashed
    const first = hash('The bug happens when the widget is resized.');
    const second = hash('The widget is resized and the bug happens.');

    // Then — the hashes differ
    expect(second).not.toBe(first);
  });

  it('matches the FNV-1a 64-bit known-answer vectors', () => {
    // Given — the canonical FNV-1a test strings

    // When — each is hashed
    // Then — the digests are the published 64-bit FNV-1a values
    expect(hash('')).toBe('cbf29ce484222325');
    expect(hash('a')).toBe('af63dc4c8601ec8c');
    expect(hash('foobar')).toBe('85944171f73967e8');
  });

  it('always renders a normalized 16-hex-character digest', () => {
    // Given — inputs of varied length, including one whose high lane is zero

    // When — each is hashed
    const digests = ['', 'a', 'foobar', 'The bug happens on resize.'].map(
      (input) => hash(input),
    );

    // Then — every digest is exactly 16 lowercase hex characters
    for (const digest of digests) {
      expect(digest).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
