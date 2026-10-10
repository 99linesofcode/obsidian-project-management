import type { FrontmatterConnection } from './FrontmatterConnection.js';
import { frontmatterLines } from './frontmatterLines.js';
import { parseConnectionsBlock } from './parseConnectionsBlock.js';

export function connectionsOf(
  content: string,
): Record<string, FrontmatterConnection> {
  const frontmatter = frontmatterLines(content);
  return frontmatter === null ? {} : parseConnectionsBlock(frontmatter);
}
