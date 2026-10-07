import { isRecord } from '../shared/isRecord.js';
import type { ProjectNoteData } from '../shared/ProjectNoteData.js';

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
    // The path says archived-or-not; the exact transition time is the
    // reconcile pass's to stamp, so discovery carries '' as "unknown" and the
    // pass replaces it on the baseline.
    archivedAt: path.startsWith('Archief/') ? '' : null,
    pm: frontmatter.pm,
    url: typeof frontmatter.url === 'string' ? frontmatter.url : '',
  };
}

// Projecten/<project>/_<project>.md or Archief/<project>/_<project>.md ->
// <project>. A pm-marked note DIRECTLY inside a project folder is that
// project's home note. The convention names it _<project>.md; the legacy
// `_home.md` and `<name>.md` forms are accepted alongside it, so discovery is
// name-agnostic and the reconcile pass migrates the file. The project name is
// ALWAYS the folder segment, never the note's basename — a folder rename needs
// no note rename, and a note deeper in the tree (taken/, todos/, a subfolder)
// is not a project home.
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
