import type { ProjectNoteData } from '../../Domain/DataTransferObjects/ProjectNoteData.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Maps a markdown file's path and frontmatter cache to a project note, or
// null when the file does not carry a pm property or is not directly inside a
// Projecten/<project>/ or Archief/<project>/ folder. Pure: no Obsidian types,
// so the filtering and project-name derivation are unit-testable without
// faking the metadataCache.
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
// A pm-marked note DIRECTLY inside a project folder is that project's home
// note. The new convention names it _home.md; the legacy <name>.md (the note
// named after its folder) is accepted alongside it, so no user file is renamed
// unbidden. The project name is ALWAYS the folder segment, never the note's
// basename — a folder rename needs no note rename, and a note deeper in the
// tree (taken/, todos/, a subfolder) is not a project home.
function projectNameFromPath(path: string): string | null {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' && segments[0] !== 'Archief') {
    return null;
  }
  // Exactly root/<project>/<file>: one trailing segment after the folder.
  if (segments.length !== 3) {
    return null;
  }
  return segments[1] ?? null;
}
