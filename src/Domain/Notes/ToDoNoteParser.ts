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

// The affiliation is a quoted wikilink list; we keep each link verbatim.
function parseAffiliation(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return [...raw.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}
