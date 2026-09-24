import { parseAffiliation } from './parseAffiliation.js';
import { splitFrontmatter } from './splitFrontmatter.js';

export interface ParsedToDoNote {
  status: string;
  completed: string | null;
  affiliation: string[];
}

// Reads a to-do note back into its frontmatter fields. Returns null when the
// note has no frontmatter or no status — i.e. it is not a to-do note.
export const ToDoNoteParser = {
  parse(content: string): ParsedToDoNote | null {
    const split = splitFrontmatter(content);
    if (!split) {
      return null;
    }
    const status = split.fields.get('status');
    if (status === undefined) {
      return null;
    }
    return {
      status,
      completed: split.fields.get('completed') || null,
      affiliation: parseAffiliation(split.fields.get('affiliation')),
    };
  },
};

// Rewrites the frontmatter status and completed lines of a to-do note,
// preserving the body and every other frontmatter field. Mirrors withStatus
// for task notes. A null stamp empties the completed field.
export function withToDoStatus(
  content: string,
  status: string,
  completedAt: string | null,
): string {
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
    if (!inFrontmatter) {
      continue;
    }
    if (line.startsWith('status:')) {
      lines[i] = `status: ${status}`;
    } else if (line.startsWith('completed:')) {
      lines[i] =
        completedAt === null ? 'completed:' : `completed: ${completedAt}`;
    }
  }
  return lines.join('\n');
}
