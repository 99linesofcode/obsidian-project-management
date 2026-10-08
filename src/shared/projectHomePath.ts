// The project home note's path under the current convention. WHY: the
// underscore pins the home note to the top of the folder and makes its
// wikilink unambiguous across projects — a bare [[<project>]] can be shadowed,
// and [[_home]] would collide between projects. Discovery stays name-agnostic
// (a pm-marked note directly inside Projecten/<project>/ or Archief/<project>/);
// this helper is the convention's target, not its identity, so a legacy note
// keeps being discovered until the reconcile pass migrates it.

// The home note's stem: `_<project>`. Shared by the path and the wikilink
// renderer so the two can never drift.
export function projectHomeStem(projectName: string): string {
  return `_${projectName}`;
}

// Projecten/<name>/_<name>.md or Archief/<name>/_<name>.md.
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
