import { describe, expect, it } from 'vitest';
import { sameLabels } from '../../src/shared/sameLabels.js';

describe('SYNC-1 — a label set is compared as a set', () => {
  it('agrees on the same labels in a different order', () => {

    const same = sameLabels(['task', 'slice'], ['slice', 'task']);

    expect(same).toBe(true);
  });

  it('disagrees when a label differs', () => {

    const same = sameLabels(['task'], ['slice']);

    expect(same).toBe(false);
  });

  it('disagrees when the sizes differ', () => {

    const same = sameLabels(['task'], ['task', 'slice']);

    expect(same).toBe(false);
  });

  it('agrees on two empty sets', () => {

    const same = sameLabels([], []);

    expect(same).toBe(true);
  });
});
