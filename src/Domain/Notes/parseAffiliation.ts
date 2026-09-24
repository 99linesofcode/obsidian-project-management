// The affiliation is a quoted wikilink list; we keep each link verbatim. Shared
// by the task-note and to-do-note parsers, which both carry an affiliation.
export function parseAffiliation(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return [...raw.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}
