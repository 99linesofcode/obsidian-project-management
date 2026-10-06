import { describe, expect, it } from 'vitest';
import { defaultStatusName } from '../../src/projects/defaultStatusName.js';
import { DomainError } from '../../src/shared/DomainError.js';

describe('LANE-1 — the default lane names the first board option', () => {
  it('returns the first option — the default state of a new card', () => {
    expect(defaultStatusName([{ id: 'opt_1', name: 'Unshaped' }])).toBe(
      'Unshaped',
    );
  });

  it('throws a domain error when the project has no status options', () => {
    expect(() => defaultStatusName([])).toThrow(DomainError);
  });
});
