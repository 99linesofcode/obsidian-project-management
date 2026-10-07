import type { ConnectionData } from '../shared/ConnectionData.js';

// Renders the canonical `connections` block lines (the `connections:` key and
// its nested entries) for a note's frontmatter. The insertion order of the map
// is the render order, so a migrated note reads github then todoist.
export function renderConnectionsBlock(
  connections: Record<string, ConnectionData>,
): string[] {
  const lines = ['connections:'];
  for (const [slug, connection] of Object.entries(connections)) {
    lines.push(`  ${slug}:`);
    lines.push(`    tool: ${connection.tool}`);
    lines.push(`    project: ${connection.project}`);
  }
  return lines;
}
