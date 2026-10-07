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
