import type { CanonicalField } from '../../core/domain/canonicalField.js';
import type { CanonicalFieldWrite } from '../../core/port/data/CanonicalFieldWrite.js';
import {
  parseAffiliation,
  parentStemFromAffiliation,
  taskLinkFromAffiliation,
} from '../../core/domain/affiliation.js';
import {
  isCompleted,
  labelSequence,
  labelsFromNote,
  splitFrontmatter,
  typeFromLabels,
  withBody,
} from '../../core/domain/note.js';
import { projectFromNotePath } from '../../core/domain/paths.js';

export interface TaskNote {
  title: string;
  status: string;
  body: string;
  completed: boolean;
  parent: string | null;
  labels: readonly string[];
}

export function parseTaskNote(content: string, handle: string): TaskNote {
  const split = splitFrontmatter(content);
  const fields = split?.fields ?? new Map<string, string>();
  const labels = labelsFromNote(content);
  return {
    title: titleFromPath(handle),
    status: fields.get('status') ?? '',
    body: split?.body ?? content,
    completed: isCompleted(fields),
    parent: parentFromAffiliation(fields.get('affiliation'), handle, labels),
    labels,
  };
}

export function fieldValue(note: TaskNote, field: CanonicalField): string | null {
  switch (field) {
    case 'title':
      return note.title;
    case 'body':
      return note.body;
    case 'Status':
      return note.status;
    case 'completion':
      return note.completed ? 'true' : 'false';
    case 'subtasks':
      return note.parent;
    case 'label':
      return labelSequence(note.labels);
  }
}

export function writeIntoNote(
  content: string,
  write: CanonicalFieldWrite,
): string {
  switch (write.field) {
    case 'body':
      return withBody(content, write.value ?? '');
    case 'Status':
      return withFrontmatter(content, 'status', write.value);
    case 'completion':
      return withFrontmatter(
        content,
        'completed',
        write.value === 'true' ? 'true' : null,
      );
    case 'label':
      return withLabels(content, write.value);
    case 'subtasks':
      return withParent(content, write.value);
    case 'title':
      return content;
  }
}

export function folderOf(path: string): string | null {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? null : path.slice(0, slash);
}

function titleFromPath(handle: string): string {
  const basename = handle.split('/').pop() ?? '';
  const stem = basename.replace(/\.md$/, '').replace(/^\d+-/, '');
  return stem.replace(/-/g, ' ');
}

function parentFromAffiliation(
  raw: string | undefined,
  handle: string,
  labels: readonly string[],
): string | null {
  const affiliation = parseAffiliation(raw);
  const project = projectFromNotePath(handle);
  if (typeFromLabels(labels) === 'todo') {
    return (
      parentStemFromAffiliation(affiliation, project) ??
      taskLinkFromAffiliation(affiliation, project)
    );
  }
  return taskLinkFromAffiliation(affiliation, project);
}

function withFrontmatter(
  content: string,
  key: string,
  value: string | null,
): string {
  const lines = content.split('\n');
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (closing === -1) {
    return content;
  }

  for (let i = 1; i < closing; i++) {
    if (lines[i]!.startsWith(`${key}:`)) {
      lines[i] = renderLine(key, value);
      return lines.join('\n');
    }
  }

  lines.splice(closing, 0, renderLine(key, value));
  return lines.join('\n');
}

function withLabels(content: string, value: string | null): string {
  const lines = content.split('\n');
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (closing === -1) {
    return content;
  }
  const index = lines.findIndex(
    (line, i) => i > 0 && i < closing && line.startsWith('labels:'),
  );
  if (index === -1) {
    lines.splice(closing, 0, renderLine('labels', value));
    return lines.join('\n');
  }
  let removed = 1;
  while (
    index + removed < closing &&
    /^\s*-\s/.test(lines[index + removed]!)
  ) {
    removed++;
  }
  lines.splice(index, removed, renderLine('labels', value));
  return lines.join('\n');
}

function withParent(content: string, parent: string | null): string {
  const raw = splitFrontmatter(content)?.fields.get('affiliation');
  if (raw === undefined) {
    return content;
  }
  const project = parseAffiliation(raw)[0];
  if (project === undefined) {
    return content;
  }

  const next = parent === null ? [project] : [project, `[[${parent}]]`];
  const value = `[${next.map((link) => `"${link}"`).join(', ')}]`;
  return withFrontmatter(content, 'affiliation', value);
}

function renderLine(key: string, value: string | null): string {
  return value === null ? `${key}:` : `${key}: ${value}`;
}
