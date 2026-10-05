import { projectHomeStem } from './projectHomePath.js';

// The project entry's wikilink in an affiliation: `[[_<project>]]`, the link
// that resolves to the home note under the rename convention. Renderers emit
// this form; the reconcile pass's rename migration guarantees the target exists
// before a new note renders it.
export function projectAffiliationLink(projectName: string): string {
  return `[[${projectHomeStem(projectName)}]]`;
}

// Whether a stripped affiliation target names the project entry. The rename
// convention means Obsidian's link update may rewrite an existing note's entry
// from `[[<project>]]` to `[[_<project>]]`, so BOTH forms count — a note written
// before the migration and one written after parse identically. Exact match
// only: a parent note could legitimately start with an underscore, so the
// underscore is never blanket-stripped.
export function isProjectAffiliationEntry(
  target: string,
  projectName: string,
): boolean {
  return target === projectName || target === projectHomeStem(projectName);
}
