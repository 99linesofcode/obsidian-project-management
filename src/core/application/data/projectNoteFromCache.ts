import { isRecord } from '../../domain/isRecord.js';
import type { ConnectionValidationService } from '../services/ConnectionValidationService.js';
import type { ProjectNoteDataTransferObject } from '../../port/data/ProjectNoteDataTransferObject.js';
import { projectNameFromPath } from '../../domain/paths.js';

export function projectNoteFromCache(
  path: string,
  frontmatter: unknown,
  connectionValidator: ConnectionValidationService,
): ProjectNoteDataTransferObject | null {
  if (!isRecord(frontmatter) || !isRecord(frontmatter.connections)) {
    return null;
  }
  if (Object.keys(frontmatter.connections).length === 0) {
    return null;
  }
  const folderName = projectNameFromPath(path);
  if (folderName === null) {
    return null;
  }
  const declared = frontmatter.project;
  const projectName =
    typeof declared === 'string' && declared !== '' ? declared : folderName;
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
