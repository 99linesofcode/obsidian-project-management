import { isRecord } from '../core/isRecord.js';
import type { ConnectionValidator } from '../core/ConnectionValidator.js';
import type { ProjectNoteData } from '../core/ProjectNoteData.js';
import { projectNameFromPath } from './projectNameFromPath.js';

export function projectNoteFromCache(
  path: string,
  frontmatter: unknown,
  connectionValidator: ConnectionValidator,
): ProjectNoteData | null {
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
