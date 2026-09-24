import { fillFrontmatterFields } from './fillFrontmatterFields.js';
import type { VaultPort } from '../Ports/VaultPort.js';

// Writes one sync-owned field into a note's frontmatter, in place when the
// field is declared and appended otherwise. A note without a frontmatter block
// cannot carry the field and is left untouched. Shared by the project mirror
// (the `todoist` project anchor) and the task projection (the `todoist` task
// anchor) so both stamp the same way.
export async function stampFrontmatterField(
  vault: VaultPort,
  notePath: string,
  content: string,
  key: string,
  value: string,
): Promise<void> {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return;
  }
  const frontmatter = fillFrontmatterFields(
    lines.slice(0, closing + 1),
    new Map([[key, value]]),
  );
  await vault.writeNote(
    notePath,
    [...frontmatter, ...lines.slice(closing + 1)].join('\n'),
  );
}
