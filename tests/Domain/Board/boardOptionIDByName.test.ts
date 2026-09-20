import { describe, expect, it } from 'vitest';
import { boardOptionIDByName } from '../../../src/Domain/Board/boardOptionIDByName.js';
import { DomainError } from '../../../src/Domain/Errors/DomainError.js';

const options = [
  { id: 'opt_1', name: 'Todo' },
  { id: 'opt_2', name: 'In Progress' },
  { id: 'opt_3', name: 'Shipped' },
];

describe('boardOptionIDByName', () => {
  it('resolves an option id by its exact name', () => {
    expect(boardOptionIDByName(options, 'In Progress')).toBe('opt_2');
    expect(boardOptionIDByName(options, 'Shipped')).toBe('opt_3');
  });

  it('throws a domain error for an unknown name', () => {
    expect(() => boardOptionIDByName(options, 'Done')).toThrow(DomainError);
  });
});
