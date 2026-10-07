import type { ConnectionData } from '../shared/ConnectionData.js';
import { frontmatterLines } from './frontmatterLines.js';
import { parseConnectionsBlock } from './parseConnectionsBlock.js';

// The note's connection envelope, or an empty map when it has none. The one
// reader every consumer of a note's connections shares.
export function connectionsOf(content: string): Record<string, ConnectionData> {
  const frontmatter = frontmatterLines(content);
  return frontmatter === null ? {} : parseConnectionsBlock(frontmatter);
}
