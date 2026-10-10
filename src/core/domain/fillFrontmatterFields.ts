// Fills sync-owned fields into a frontmatter block: a field the block declares
// (even empty) gets its value in place; a missing one is appended before the
// closing delimiter. The values' insertion order is the append order.
export function fillFrontmatterFields(
  lines: string[],
  values: Map<string, string>,
): string[] {
  const filled = [...lines];
  const missing: string[] = [];

  for (const key of values.keys()) {
    const index = filled.findIndex((line) => line.startsWith(`${key}:`));
    if (index === -1) {
      missing.push(key);
      continue;
    }
    filled[index] = frontmatterLine(key, values.get(key) ?? '');
  }

  const appended = missing.map((key) =>
    frontmatterLine(key, values.get(key) ?? ''),
  );
  filled.splice(filled.length - 1, 0, ...appended);
  return filled;
}

// An empty value renders as a bare key — the field is present but null.
function frontmatterLine(key: string, value: string): string {
  return value === '' ? `${key}:` : `${key}: ${value}`;
}
