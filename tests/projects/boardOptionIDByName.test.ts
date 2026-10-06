import { describe, expect, it } from 'vitest';
import { boardOptionIDByName } from '../../src/projects/boardOptionIDByName.js';
import { DomainError } from '../../src/shared/DomainError.js';

const options = [
  { id: 'opt_1', name: 'Unshaped' },
  { id: 'opt_2', name: 'Building' },
  { id: 'opt_3', name: 'Shipped' },
];

describe('LANE-1 — the board lane vocabulary maps to option ids', () => {
  it('resolves an option id by its exact name', () => {
    expect(boardOptionIDByName(options, 'Building')).toBe('opt_2');
    expect(boardOptionIDByName(options, 'Shipped')).toBe('opt_3');
  });

  it('throws a domain error for an unknown name', () => {
    expect(() => boardOptionIDByName(options, 'Done')).toThrow(DomainError);
  });
});
