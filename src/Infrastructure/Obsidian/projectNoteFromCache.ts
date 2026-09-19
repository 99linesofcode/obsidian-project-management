import type { ProjectNoteData } from '../../Domain/DataTransferObjects/ProjectNoteData.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Maps a markdown file's path and frontmatter cache to a project note, or
// null when the file does not carry a pm property. Pure: no Obsidian types,
// so the filtering and project-name derivation are unit-testable without
// faking the metadataCache.
export function projectNoteFromCache(
  path: string,
  frontmatter: unknown,
): ProjectNoteData | null {
  if (!isRecord(frontmatter) || typeof frontmatter.pm !== 'string') {
    return null;
  }
  return {
    path,
    projectName: projectNameFromPath(path),
    pm: frontmatter.pm,
    url: typeof frontmatter.url === 'string' ? frontmatter.url : '',
    board: typeof frontmatter.board === 'string' ? frontmatter.board : '',
  };
}

// Projecten/<project>/_home.md -> <project>
function projectNameFromPath(path: string): string {
  const segments = path.split('/');
  if (segments[0] === 'Projecten' && segments.length >= 2) {
    return segments[1] ?? '';
  }
  return '';
}
