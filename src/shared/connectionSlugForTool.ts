import type { ConnectionData } from './ConnectionData.js';

// The slug of the first connection whose tool matches, or null. A project may
// hold several connections of the same tool; the first is the default for a
// surface that addresses one connection (the promote UI, a cross-connection
// propagation).
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
