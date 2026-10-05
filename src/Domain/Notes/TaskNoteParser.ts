import { parseAffiliation } from './parseAffiliation.js';
import { splitFrontmatter } from './splitFrontmatter.js';

export interface ParsedTaskNote {
  // The vault-owned content type (task/slice/bug). '' when absent.
  type: string;
  status: string;
  body: string;
  // The affiliation wikilinks, project first then the slice (when nested).
  affiliation: string[];
}

// Reads a task note back into its sync fields. A task note is recognised by its
// frontmatter alone. Identity is NOT read from the note (dt-20): the frontmatter
// `id` is gone by decision, and the note resolves to its record through the
// registry's path index. The status is the project's Status option name,
// verbatim.
export const TaskNoteParser = {
  parse(content: string): ParsedTaskNote | null {
    const split = splitFrontmatter(content);
    if (!split) {
      return null;
    }
    return {
      type: split.fields.get('type') ?? '',
      status: split.fields.get('status') ?? '',
      body: split.body,
      affiliation: parseAffiliation(split.fields.get('affiliation')),
    };
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
