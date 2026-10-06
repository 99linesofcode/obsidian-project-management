// Rewrites the named frontmatter fields in place, preserving the body and every
// other field. A null value renders as a bare key. A field the block does not
// declare is left absent unless appendMissing is set, in which case it is
// appended before the closing delimiter. A note with no frontmatter block is
// returned unchanged.
export function rewriteFrontmatterFields(
  content: string,
  values: Map<string, string | null>,
  appendMissing = false,
): string {
  const lines = content.split('\n');
  let inFrontmatter = false;
  let closing = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && line === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line === '---') {
      closing = i;
      break;
    }
    if (!inFrontmatter) {
      continue;
    }
    for (const [key, value] of values) {
      if (line.startsWith(`${key}:`)) {
        lines[i] = value === null ? `${key}:` : `${key}: ${value}`;
        break;
      }
    }
  }
  if (appendMissing && closing !== -1) {
    const missing = [...values.keys()].filter(
      (key) =>
        !lines.slice(0, closing).some((line) => line.startsWith(`${key}:`)),
    );
    const appended = missing.map((key) => {
      const value = values.get(key) ?? null;
      return value === null ? `${key}:` : `${key}: ${value}`;
    });
    lines.splice(closing, 0, ...appended);
  }
  return lines.join('\n');
}
