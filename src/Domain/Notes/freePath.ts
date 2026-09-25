import type { VaultPort } from '../Ports/VaultPort.js';

// Suffixes -2, -3, … until the note path is free. Shared by the checklist sync
// and the Todoist capture so both handle a slug collision the same way.
export async function freePath(
  vault: VaultPort,
  base: string,
): Promise<string> {
  if (!(await vault.getNoteByPath(base))) {
    return base;
  }
  const stem = base.replace(/\.md$/, '');
  let suffix = 2;
  while (await vault.getNoteByPath(`${stem}-${suffix}.md`)) {
    suffix++;
  }
  return `${stem}-${suffix}.md`;
}