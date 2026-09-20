import { describe, expect, it } from 'vitest';
import { stateFromStatus } from '../../../src/Domain/Board/stateFromStatus.js';

describe('stateFromStatus', () => {
  it('closes the issue only for the done lane', () => {
    expect(stateFromStatus('Shipped', 'Shipped')).toBe('closed');
  });

  it('leaves the issue open for every other lane', () => {
    expect(stateFromStatus('Todo', 'Shipped')).toBe('open');
    expect(stateFromStatus('In Progress', 'Shipped')).toBe('open');
  });
});
