import type { VaultPort } from './VaultPort.js';

// The template note's content, or null when it does not exist — render falls
// back to the built-in frontmatter.
export async function readTemplate(
  vault: VaultPort,
  path: string,
): Promise<string | null> {
  const note = await vault.getNoteByPath(path);
  return note?.content ?? null;
}
