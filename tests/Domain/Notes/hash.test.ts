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
});
