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

export function projectNameFromPath(path: string): string | null {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' && segments[0] !== 'Archief') {
    return null;
  }
  if (segments.length !== 3) {
    return null;
  }
  return segments[1] ?? null;
}

// Whether a note path lives under the archived root. The folder is the archived
// state — nothing stores it — so every reader derives it from the path here.
export function archivedFromPath(path: string): boolean {
  return path.startsWith('Archief/');
}

// The same note path with its project segment replaced. Both roots name the
// project in the second segment, so a rename rewrites it in place and every
// other segment is preserved.
export function projectPathWithName(path: string, projectName: string): string {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' && segments[0] !== 'Archief') {
    return path;
  }
  if (segments.length < 2) {
    return path;
  }
  segments[1] = projectName;
  return segments.join('/');
}

// The home note's stem: `_<project>`. Shared by the path and the wikilink
// renderer so the two can never drift.
export function projectHomeStem(projectName: string): string {
  return `_${projectName}`;
}

// Projecten/<name>/_<name>.md or Archief/<name>/_<name>.md.
// The project home note's path under the current convention. WHY: the
// underscore pins the home note to the top of the folder and makes its
// wikilink unambiguous across projects — a bare [[<project>]] can be shadowed,
// and [[_home]] would collide between projects. Discovery stays name-agnostic
// (a pm-marked note directly inside Projecten/<project>/ or Archief/<project>/);
// this helper is the convention's target, not its identity, so a legacy note
// keeps being discovered until the reconcile pass migrates it.
export function projectHomePath(
  projectName: string,
  archived: boolean,
): string {
  const root = archived ? 'Archief' : 'Projecten';
  return `${root}/${projectName}/${projectHomeStem(projectName)}.md`;
}

export function chooseHomeNotePath(
  paths: readonly string[],
  projectName: string,
): string | null {
  const conventionalStem = `${projectHomeStem(projectName)}.md`;
  const conventional = paths.find(
    (path) => path.split('/').pop() === conventionalStem,
  );
  return conventional ?? paths[0] ?? null;
}

// The ordered list of folder paths that must exist for a note path, from the
// vault root down. Obsidian's createFolder only makes one level, so the
// adapter walks this list in order to build the chain (mkdir -p semantics).
export function folderChainForPath(path: string): string[] {
  const segments = path.split('/');
  segments.pop(); // the filename

  const folders: string[] = [];
  let acc = '';
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    folders.push(acc);
  }
  return folders;
}

export interface FreePathVault {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
}

// Suffixes -2, -3, … until the note path is free. Shared by the checklist sync
// and the task-manager capture so both handle a slug collision the same way.
export async function freePath(
  vault: FreePathVault,
  base: string,
): Promise<string> {
  if (!(await vault.getNoteByPath(base))) {
    return base;
  }
  const stem = base.replace(/\.md$/, '');
  let suffix = 2;
  while (await vault.getNoteByPath(`${stem}-${suffix}.md`)) {
    suffix++;
  }
  return `${stem}-${suffix}.md`;
}
