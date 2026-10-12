import { parseAffiliation } from './affiliation.js';
import {
  labelsFromNote,
  rewriteFrontmatterFields,
  splitFrontmatter,
  typeFromLabels,
} from './note.js';

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

// Whether a note carries the `type:todo` label, in either the flow or the block
// form.
export function isToDoNote(content: string): boolean {
  return typeFromLabels(labelsFromNote(content)) === 'todo';
}

// Rewrites the frontmatter status and completed lines of a to-do note,
// preserving the body and every other frontmatter field. Mirrors withStatus
// for task notes. A null stamp empties the completed field.
export function withToDoStatus(
  content: string,
  status: string,
  completedAt: string | null,
): string {
  return rewriteFrontmatterFields(
    content,
    new Map([
      ['status', status],
      ['completed', completedAt],
    ]),
  );
}
