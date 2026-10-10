import { projectHomeStem } from './projectHomePath.js';
import { stripLink } from './stripLink.js';

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

// The affiliation's non-project targets, in order: a task's slice, then a
// to-do's parent task, then — when nested — the parent to-do. The project entry
// is dropped in both its pre- and post-rename forms.
export function affiliationTargets(
  affiliation: string[],
  projectName: string,
): string[] {
  return affiliation
    .map(stripLink)
    .filter((target) => !isProjectAffiliationEntry(target, projectName));
}

// The parent to-do's stem named by a to-do's affiliation: the second non-project
// target. A to-do with no parent link returns null.
export function parentStemFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  return affiliationTargets(affiliation, projectName)[1] ?? null;
}
