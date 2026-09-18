import { describe, expect, it } from 'vitest';

// Harness proof only — no domain logic exists yet, so there is nothing
// behavioural to assert. This guards the vitest toolchain itself.
describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
