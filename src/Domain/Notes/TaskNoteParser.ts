import { TaskStatus } from '../Enums/TaskStatus.js';

export interface ParsedTaskNote {
  url: string;
  status: TaskStatus;
  body: string;
}

// Splits a note into its YAML frontmatter (as a flat key/value map) and body.
// Returns null when the note has no frontmatter block.
function splitFrontmatter(content: string): { fields: Map<string, string>; body: string } | null {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return null;
  }
  const fields = new Map<string, string>();
  let i = 1;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    if (colon > 0) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  if (i >= lines.length) {
    return null;
  }
  return { fields, body: lines.slice(i + 1).join('\n') };
}

// Reads a task note back into its sync fields. Returns null when the note has
// no url frontmatter — i.e. it is not a synced artifact.
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
    const status = split.fields.get('status') === 'done' ? TaskStatus.Done : TaskStatus.Open;
    return { url, status, body: split.body };
  },
};
