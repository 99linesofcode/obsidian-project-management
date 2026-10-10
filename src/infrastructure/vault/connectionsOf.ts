import type { ConnectionData } from '../../domain/data/ConnectionData.js';
import { frontmatterLines } from './frontmatterLines.js';
import { parseConnectionsBlock } from './parseConnectionsBlock.js';

export function connectionsOf(content: string): Record<string, ConnectionData> {
  const frontmatter = frontmatterLines(content);
  return frontmatter === null ? {} : parseConnectionsBlock(frontmatter);
}
