import { describe, expect, it } from 'vitest';
import { sameLabels } from '../../../src/Domain/Labels/sameLabels.js';

describe('sameLabels', () => {
  it('agrees on the same labels in a different order', () => {
    // Given — two label sets with the same members

    // When — they are compared
    const same = sameLabels(['task', 'slice'], ['slice', 'task']);

    // Then — they agree
    expect(same).toBe(true);
  });

  it('disagrees when a label differs', () => {
    // Given — two label sets with different members

    // When — they are compared
    const same = sameLabels(['task'], ['slice']);

    // Then — they disagree
    expect(same).toBe(false);
  });

  it('disagrees when the sizes differ', () => {
    // Given — a set with an extra label

    // When — they are compared
    const same = sameLabels(['task'], ['task', 'slice']);

    // Then — they disagree
    expect(same).toBe(false);
  });

  it('agrees on two empty sets', () => {
    // Given — two empty label sets

    // When — they are compared
    const same = sameLabels([], []);

    // Then — they agree
    expect(same).toBe(true);
  });
});
