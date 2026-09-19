import type { ProjectStatusOption } from '../DataTransferObjects/ProjectIdentityData.js';
import { DomainError } from '../Errors/DomainError.js';

// The board Status option id to set for a given note status: the done option
// (matched by name) for a done note, the first option (the default state of a
// new card) for an open note. An unknown done-option name is a config error.
export function boardOptionId(
  statusOptions: ProjectStatusOption[],
  doneOptionName: string,
  status: 'done' | 'open',
): string {
  if (status === 'done') {
    const done = statusOptions.find((option) => option.name === doneOptionName);
    if (!done) {
      throw new DomainError(
        `Board: no status option named "${doneOptionName}"`,
      );
    }
    return done.id;
  }
  const open = statusOptions[0];
  if (!open) {
    throw new DomainError('Board: project has no status options');
  }
  return open.id;
}

// The note status a board Status option name implies: the done option is done,
// every other option is open.
export function statusFromBoardOption(
  doneOptionName: string,
  optionName: string,
): 'done' | 'open' {
  return optionName === doneOptionName ? 'done' : 'open';
}
