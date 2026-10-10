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
