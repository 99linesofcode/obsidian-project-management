import { isRecord } from '../shared/isRecord.js';
import { ConnectionValidator } from '../shared/ConnectionValidator.js';
import type { ProjectNoteData } from '../shared/ProjectNoteData.js';
import { projectNameFromPath } from './projectNameFromPath.js';

const connectionValidator = new ConnectionValidator();

// Maps a markdown file's path and frontmatter cache to a project note, or null
// when the file does not declare a non-empty `connections` map or is not
// directly inside a Projecten/<project>/ or Archief/<project>/ folder. Pure: no
// Obsidian types, so the filtering and project-name derivation are
// unit-testable without faking the metadataCache.
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
    // The path says archived-or-not; the exact transition time is the
    // reconcile pass's to stamp, so discovery carries '' as "unknown" and the
    // pass replaces it on the baseline.
    archivedAt: path.startsWith('Archief/') ? '' : null,
    connections,
    connectionErrors: errors,
  };
}
