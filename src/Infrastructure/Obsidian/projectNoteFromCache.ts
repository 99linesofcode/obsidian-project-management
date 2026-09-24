import type { ProjectNoteData } from '../../Domain/DataTransferObjects/ProjectNoteData.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Maps a markdown file's path and frontmatter cache to a project note, or
// null when the file does not carry a pm property or does not live under
// Projecten/ or Archief/. Pure: no Obsidian types, so the filtering and
// project-name derivation are unit-testable without faking the metadataCache.
export function projectNoteFromCache(
  path: string,
  frontmatter: unknown,
): ProjectNoteData | null {
  if (!isRecord(frontmatter) || typeof frontmatter.pm !== 'string') {
    return null;
  }
  const projectName = projectNameFromPath(path);
  if (projectName === null) {
    return null;
  }
  return {
    path,
    projectName,
    archived: path.startsWith('Archief/'),
    pm: frontmatter.pm,
    url: typeof frontmatter.url === 'string' ? frontmatter.url : '',
    board: typeof frontmatter.board === 'string' ? frontmatter.board : '',
  };
}

// Projecten/<project>/_home.md or Archief/<project>/_home.md -> <project>.
// A pm note anywhere else is not a project note.
function projectNameFromPath(path: string): string | null {
  const segments = path.split('/');
  if (
    (segments[0] === 'Projecten' || segments[0] === 'Archief') &&
    segments.length >= 2
  ) {
    return segments[1] ?? null;
  }
  return null;
}
