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
  const projectName = projectNameFromPath(path);
  if (projectName === null) {
    return null;
  }
  const { connections, errors } = connectionValidator.validate(
    frontmatter.connections,
  );
  if (connections.length === 0) {
    return null;
  }
  return {
    id: vaultId(frontmatter.connections),
    path,
    projectName,
    connections,
    connectionErrors: errors,
  };
}

function vaultId(connections: Record<string, unknown>): string {
  const vault = connections.vault;
  if (!isRecord(vault) || typeof vault.id !== 'string') {
    return '';
  }
  return vault.id;
}
