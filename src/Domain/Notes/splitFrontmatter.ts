// Splits a note into its YAML frontmatter (as a flat key/value map) and body.
// Returns null when the note has no frontmatter block.
export interface SplitFrontmatter {
  fields: Map<string, string>;
  body: string;
}

export function splitFrontmatter(content: string): SplitFrontmatter | null {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return null;
  }
  const fields = new Map<string, string>();
  let i = 1;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    if (colon > 0) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  if (i >= lines.length) {
    return null;
  }
  return { fields, body: lines.slice(i + 1).join('\n') };
}
