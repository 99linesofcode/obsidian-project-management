import type { VaultPort } from '../shared/VaultPort.js';
import { frontmatterLines } from './frontmatterLines.js';
import { parseConnectionsBlock } from './parseConnectionsBlock.js';
import { renderConnectionsBlock } from './renderConnectionsBlock.js';
import { stripConnectionsBlock } from './stripConnectionsBlock.js';

export async function stampConnectionProject(
  vault: VaultPort,
  notePath: string,
  content: string,
  slug: string,
  project: string,
): Promise<void> {
  const lines = content.split('\n');
  const frontmatter = frontmatterLines(content);
  if (frontmatter === null) {
    return;
  }
  const closing = lines.indexOf('---', 1);
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
