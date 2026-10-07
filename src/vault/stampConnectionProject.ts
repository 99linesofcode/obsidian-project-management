import type { VaultPort } from '../shared/VaultPort.js';
import { parseConnectionsBlock } from './parseConnectionsBlock.js';
import { renderConnectionsBlock } from './renderConnectionsBlock.js';
import { stripConnectionsBlock } from './stripConnectionsBlock.js';

// Rewrites one connection's `project` value in a note's frontmatter, in place.
// WHY a dedicated writer: the connections block is nested, so the flat
// stampFrontmatterField cannot reach it. A re-anchor is a re-key of the block,
// never a legacy top-level property.
export async function stampConnectionProject(
  vault: VaultPort,
  notePath: string,
  content: string,
  slug: string,
  project: string,
): Promise<void> {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return;
  }
  const frontmatter = lines.slice(1, closing);
  const connections = parseConnectionsBlock(frontmatter);
  const connection = connections[slug];
  if (connection === undefined) {
    return;
  }
  connection.project = project;
  const rebuilt = [
    '---',
    ...stripConnectionsBlock(frontmatter),
    ...renderConnectionsBlock(connections),
    '---',
    ...lines.slice(closing + 1),
  ];
  await vault.writeNote(notePath, rebuilt.join('\n'));
}
