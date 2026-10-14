export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
