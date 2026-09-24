import { splitFrontmatter } from './splitFrontmatter.js';

export interface ParsedTaskNote {
  url: string;
  status: string;
  body: string;
}

// Reads a task note back into its sync fields. Returns null when the note has
// no url frontmatter — i.e. it is not a synced artifact. The status is the
// project's Status option name, verbatim.
export const TaskNoteParser = {
  parse(content: string): ParsedTaskNote | null {
    const split = splitFrontmatter(content);
    if (!split) {
      return null;
    }
    const url = split.fields.get('url');
    if (!url) {
      return null;
    }
    const status = split.fields.get('status') ?? '';
    return { url, status, body: split.body };
  },
};

// Rewrites the frontmatter status line of a task note, preserving the body
// and every other frontmatter field. Used to mirror a status change onto a
// note whose body was just pushed, without clobbering the pushed body.
export function withStatus(content: string, status: string): string {
  const lines = content.split('\n');
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && line === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line === '---') {
      break;
    }
    if (inFrontmatter && line.startsWith('status:')) {
      lines[i] = `status: ${status}`;
      break;
    }
  }
  return lines.join('\n');
}
