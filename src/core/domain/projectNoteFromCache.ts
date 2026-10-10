import { isRecord } from './isRecord.js';
import type { ConnectionValidator } from './ConnectionValidator.js';
import type { ProjectNoteDataTransferObject } from '../application/data/ProjectNoteDataTransferObject.js';
import { projectNameFromPath } from './projectNameFromPath.js';

export function projectNoteFromCache(
  path: string,
  frontmatter: unknown,
  connectionValidator: ConnectionValidator,
): ProjectNoteDataTransferObject | null {
  if (!isRecord(frontmatter) || !isRecord(frontmatter.connections)) {
    return null;
  }
  if (Object.keys(frontmatter.connections).length === 0) {
    return null;
  }
  const projectName = projectNameFromPath(path);
  if (projectName === null) {
    return null;
  }
  const { connections, errors } = connectionValidator.validate(
    frontmatter.connections,
  );
  return {
    path,
    projectName,
    archivedAt: path.startsWith('Archief/') ? '' : null,
    connections,
    connectionErrors: errors,
  };
}
