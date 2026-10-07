// Removes the `connections:` block (its key and every indented line) from a
// note's frontmatter lines, so a rebuilt block replaces it rather than
// duplicating it. Shared by the migration and the anchor re-stamp.
export function stripConnectionsBlock(lines: string[]): string[] {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith('connections:')) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.startsWith(' ')) {
        continue;
      }
      inBlock = false;
    }
    kept.push(line);
  }
  return kept;
}
