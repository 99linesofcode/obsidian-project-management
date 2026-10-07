import type { ConnectionData } from '../shared/ConnectionData.js';

// Parses the `connections` block from a note's frontmatter lines (the lines
// between the `---` delimiters). The block is the canonical nested map the
// migration writes:
//
//   connections:
//     <slug>:
//       tool: <tool>
//       project: <project>
//
// A note without the block yields an empty map. Only the canonical block form
// is read; an inline value is ignored, because the migration always writes the
// block and the metadata cache is the reader for hand-authored notes.
export function parseConnectionsBlock(
  frontmatterLines: string[],
): Record<string, ConnectionData> {
  const connections: Record<string, ConnectionData> = {};
  let currentSlug: string | null = null;
  let inBlock = false;

  for (const line of frontmatterLines) {
    if (line.startsWith('connections:')) {
      inBlock = true;
      currentSlug = null;
      continue;
    }
    if (!inBlock) {
      continue;
    }
    if (!line.startsWith(' ')) {
      break;
    }
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (indent === 2 && trimmed.endsWith(':')) {
      currentSlug = trimmed.slice(0, -1);
      connections[currentSlug] = { tool: '', project: '' };
      continue;
    }
    if (indent === 4 && currentSlug !== null) {
      const entry = connections[currentSlug];
      if (entry === undefined) {
        continue;
      }
      const colon = trimmed.indexOf(':');
      if (colon <= 0) {
        continue;
      }
      const key = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim();
      if (key === 'tool') {
        entry.tool = value;
      } else if (key === 'project') {
        entry.project = value;
      }
    }
  }
  return connections;
}
