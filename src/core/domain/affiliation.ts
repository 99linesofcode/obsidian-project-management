import { projectHomeStem } from './paths.js';

export function stripLink(link: string): string {
  return link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
}

export function parseAffiliation(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return [...raw.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}

export function projectAffiliationLink(projectName: string): string {
  return `[[${projectHomeStem(projectName)}]]`;
}

export function isProjectAffiliationEntry(
  target: string,
  projectName: string,
): boolean {
  return target === projectName || target === projectHomeStem(projectName);
}

export function affiliationTargets(
  affiliation: string[],
  projectName: string,
): string[] {
  return affiliation
    .map(stripLink)
    .filter((target) => !isProjectAffiliationEntry(target, projectName));
}

export function parentStemFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  return affiliationTargets(affiliation, projectName)[1] ?? null;
}

export function taskLinkFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  return affiliationTargets(affiliation, projectName)[0] ?? null;
}
