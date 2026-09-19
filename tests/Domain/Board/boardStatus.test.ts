import { describe, expect, it } from 'vitest';
import { boardOptionId, statusFromBoardOption } from '../../../src/Domain/Board/boardStatus.js';
import type { ProjectStatusOption } from '../../../src/Domain/DataTransferObjects/ProjectIdentityData.js';

const options: ProjectStatusOption[] = [
  { id: 'PVTSSF_1', name: 'Todo' },
  { id: 'PVTSSF_2', name: 'In progress' },
  { id: 'PVTSSF_3', name: 'Done' },
];

describe('boardOptionId', () => {
  it('returns the done option id for a done note', () => {
    // Given — a board with a Done option and a done note
    // When — the done option id is resolved
    const id = boardOptionId(options, 'Done', 'done');
    // Then — the Done option's id is returned
    expect(id).toBe('PVTSSF_3');
  });

  it('returns the first option id for an open note', () => {
    // Given — a board with status options and an open note
    // When — the open option id is resolved
    const id = boardOptionId(options, 'Done', 'open');
    // Then — the first (default) option's id is returned
    expect(id).toBe('PVTSSF_1');
  });

  it('throws a clear error for an unknown done-option name', () => {
    // Given — a board with no option matching the configured done name
    // When — the done option id is resolved
    // Then — it fails with a clear error
    expect(() => boardOptionId(options, 'Shipped', 'done')).toThrow(/Shipped/);
  });

  it('throws when the project has no status options', () => {
    // Given — a board with no status options
    // When — the open option id is resolved
    // Then — it fails with a clear error
    expect(() => boardOptionId([], 'Done', 'open')).toThrow(/no status options/);
  });
});

describe('statusFromBoardOption', () => {
  it('maps the done option name to done', () => {
    // Given — a board option named Done
    // When — the option name is mapped to a note status
    const status = statusFromBoardOption('Done', 'Done');
    // Then — it is done
    expect(status).toBe('done');
  });

  it('maps every other option name to open', () => {
    // Given — a board option named In progress
    // When — the option name is mapped to a note status
    const status = statusFromBoardOption('Done', 'In progress');
    // Then — it is open
    expect(status).toBe('open');
  });
});
