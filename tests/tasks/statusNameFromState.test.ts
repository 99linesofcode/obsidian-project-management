import { describe, expect, it } from 'vitest';
import { statusNameFromState } from '../../src/shared/statusNameFromState.js';

describe('LANE-2 — an issue state maps to a lane', () => {
  it('puts a closed issue in the done lane', () => {
    expect(statusNameFromState('closed', 'Shipped', 'Unshaped')).toBe(
      'Shipped',
    );
  });

  it('puts an open issue in the default lane', () => {
    expect(statusNameFromState('open', 'Shipped', 'Unshaped')).toBe('Unshaped');
  });
});
