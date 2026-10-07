import type { ConnectionData } from '../shared/ConnectionData.js';

// Renders the canonical `connections` block lines (the `connections:` key and
// its nested entries) for a note's frontmatter. The insertion order of the map
// is the render order, so a migrated note reads github then todoist. The
// project value is double-quoted and escaped, so a value carrying a newline, a
// `#`, or a leading special character cannot break the block or inject a
// sibling key.
export function renderConnectionsBlock(
  connections: Record<string, ConnectionData>,
): string[] {
  const lines = ['connections:'];
  for (const [slug, connection] of Object.entries(connections)) {
    lines.push(`  ${slug}:`);
    lines.push(`    tool: ${connection.tool}`);
    lines.push(`    project: ${quote(connection.project)}`);
  }
  return lines;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
