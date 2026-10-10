export function nameFromTarget(target: string): string {
  let segments: string[];
  try {
    segments = new URL(target).pathname
      .split('/')
      .filter((segment) => segment.length > 0);
  } catch {
    return '';
  }
  const name = segments[1] ?? '';
  return name.endsWith('.git') ? name.slice(0, -4) : name;
}
