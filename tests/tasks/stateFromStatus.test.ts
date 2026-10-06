import { describe, expect, it } from 'vitest';
import { stateFromStatus } from '../../src/tasks/stateFromStatus.js';

describe('LANE-2 — a lane maps to an issue state', () => {
  it('closes the issue only for the done lane', () => {
    expect(stateFromStatus('Shipped', 'Shipped')).toBe('closed');
  });

  it('leaves the issue open for every other lane', () => {
    expect(stateFromStatus('Unshaped', 'Shipped')).toBe('open');
    expect(stateFromStatus('Building', 'Shipped')).toBe('open');
  });
});
