// The project a to-do path belongs to: Projecten/<project>/todos/<file>.md.
// Returns null for any other path.
export function projectFromTodoPath(path: string): string | null {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' || segments[2] !== 'todos') {
    return null;
  }
  return segments[1] ?? null;
}
