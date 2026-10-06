import { stemOf } from '../shared/stemOf.js';

// A task note's path in a project's taken folder, from an affiliation link
// (which may be a full path or a bare stem).
export function takenNotePath(projectName: string, link: string): string {
  return `Projecten/${projectName}/taken/${stemOf(link)}.md`;
}
