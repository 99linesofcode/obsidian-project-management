import type { ConnectionDataTransferObject } from '../../core/application/data/ConnectionDataTransferObject.js';
import { frontmatterLines } from './frontmatterLines.js';
import { parseConnectionsBlock } from './parseConnectionsBlock.js';

export function connectionsOf(
  content: string,
): Record<string, ConnectionDataTransferObject> {
  const frontmatter = frontmatterLines(content);
  return frontmatter === null ? {} : parseConnectionsBlock(frontmatter);
}
