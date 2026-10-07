import { isRecord } from '../shared/isRecord.js';
import { ConnectionValidator } from '../shared/ConnectionValidator.js';
import type { ProjectNoteData } from '../shared/ProjectNoteData.js';
import { projectNameFromPath } from './projectNameFromPath.js';

const connectionValidator = new ConnectionValidator();

export function projectNoteFromCache(
  path: string,
  frontmatter: unknown,
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
