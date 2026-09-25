// Whether a note path is a mirrored item of the given project: a task twin at
// Projecten/<project>/taken/<file>.md or a to-do twin at
// Projecten/<project>/todos/<file>.md.
export function isMirroredPath(path: string, projectName: string): boolean {
  return (
    path.startsWith(`Projecten/${projectName}/taken/`) ||
    path.startsWith(`Projecten/${projectName}/todos/`)
  );
}
