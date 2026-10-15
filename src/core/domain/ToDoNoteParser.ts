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

export function isToDoNote(content: string): boolean {
  return typeFromLabels(labelsFromNote(content)) === 'todo';
}

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
