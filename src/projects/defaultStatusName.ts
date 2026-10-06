// The lane a new card starts in: the project's first Status option (the
// default state of a new card). A project with no status options is a config
// error.
import type { ProjectStatusOption } from './ProjectIdentityData.js';
import { DomainError } from '../shared/DomainError.js';

export function defaultStatusName(
  statusOptions: ProjectStatusOption[],
): string {
  const first = statusOptions[0];
  if (!first) {
    throw new DomainError('Board: project has no status options');
  }
  return first.name;
}
