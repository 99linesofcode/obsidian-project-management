import type { ConnectionData } from './ConnectionData.js';

export function connectionSlugForTool(
  connections: Record<string, ConnectionData>,
  tool: string,
): string | null {
  for (const [slug, connection] of Object.entries(connections)) {
    if (connection.tool === tool) {
      return slug;
    }
  }
  return null;
}
