import type { NoteReaderPort } from './ports/NoteReaderPort.js';

// The template note's content, or null when it does not exist — render falls
// back to the built-in frontmatter.
export async function readTemplate(
  vault: NoteReaderPort,
  path: string,
): Promise<string | null> {
  const note = await vault.getNoteByPath(path);
  return note?.content ?? null;
}
