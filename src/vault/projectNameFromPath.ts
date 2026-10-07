// Projecten/<project>/_<project>.md or Archief/<project>/_<project>.md ->
// <project>. A project note DIRECTLY inside a project folder is that project's
// home note. The convention names it _<project>.md; the legacy `_home.md` and
// `<name>.md` forms are accepted alongside it, so discovery is name-agnostic
// and the reconcile pass migrates the file. The project name is ALWAYS the
// folder segment, never the note's basename — a folder rename needs no note
// rename, and a note deeper in the tree (taken/, todos/, a subfolder) is not a
// project home.
export function projectNameFromPath(path: string): string | null {
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
