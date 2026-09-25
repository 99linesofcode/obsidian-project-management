import { stripLink } from './stripLink.js';

// The first affiliation link that is not the project — a task's slice, or a
// to-do's parent task. Returns null when the affiliation carries only the
// project.
export function taskLinkFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  for (const link of affiliation) {
    const target = stripLink(link);
    if (target !== projectName) {
      return target;
    }
  }
  return null;
}