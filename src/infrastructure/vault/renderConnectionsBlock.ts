import type { ConnectionData } from '../../core/ConnectionData.js';

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
