import { describe, expect, it } from 'vitest';
import { statusNameFromState } from '../../../src/Domain/Board/statusNameFromState.js';

describe('statusNameFromState', () => {
  it('puts a closed issue in the done lane', () => {
    expect(statusNameFromState('closed', 'Shipped', 'Todo')).toBe('Shipped');
  });

  it('puts an open issue in the default lane', () => {
    expect(statusNameFromState('open', 'Shipped', 'Todo')).toBe('Todo');
  });
});
