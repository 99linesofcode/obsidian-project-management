// Resolve a project Status option by name. An unknown name is a config
// error — the caller's status does not exist on this board.
import type { ProjectStatusOption } from './ProjectIdentityData.js';
import { DomainError } from '../shared/DomainError.js';

export function boardOptionIDByName(
  statusOptions: ProjectStatusOption[],
  statusName: string,
): string {
  const option = statusOptions.find((o) => o.name === statusName);
  if (!option) {
    throw new DomainError(
      `Board: no status option named "${statusName}" (options: ${statusOptions
        .map((o) => o.name)
        .join(', ')})`,
    );
  }
  return option.id;
}
