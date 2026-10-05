// The project a note path belongs to, for the registry's project nesting. Both
// the active and archived roots key the same project: Projecten/<project>/...
// and Archief/<project>/... resolve to <project>, so archiving a project moves
// its notes but never re-keys its registry records. Returns '' for a path that
// names no project (a legacy or unparseable record), which the adapter keeps in
// an unnamed bucket rather than dropping.
export function projectFromNotePath(path: string): string {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' && segments[0] !== 'Archief') {
    return '';
  }
  return segments[1] ?? '';
}
