import { slugify } from './TaskNoteMapper.js';
import { fillFrontmatterFields } from './fillFrontmatterFields.js';
import { replaceTimestampPlaceholders } from './replaceTimestampPlaceholders.js';

export interface ToDoNoteInput {
  title: string;
  projectName: string;
  taskLink: string;
  parentTodoLink?: string;
}

export interface ToDoNoteContext {
  syncedAt: string;
  statusName: 'open' | 'completed';
  // A full ISO datetime stamp — the sync timestamp of the completion, e.g.
  // 2026-09-18T12:00:00Z. Passed through verbatim; never date-only.
  completedAt?: string;
}

export interface ToDoNote {
  path: string;
  content: string;
}

// Maps a vault-only to-do onto its note. Unlike a task note it has no remote
// issue or board card: the frontmatter carries the affiliation and status, and
// the body is empty — the note is a placeholder/status carrier.
export const ToDoNoteMapper = {
  map(input: ToDoNoteInput, context: ToDoNoteContext): ToDoNote {
    const content = [
      '---',
      'categories: ["[[Todos.base|Todos]]"]',
      `affiliation: ${affiliationValue(input)}`,
      `status: ${context.statusName}`,
      completedLine(context.completedAt),
      '---',
      '',
    ].join('\n');
    return { path: toDoNotePath(input), content };
  },

  // Renders the note through a vault template: the template's frontmatter is
  // kept verbatim (vault-owned fields), the managed fields are filled in, and
  // {{date}}/{{time}} resolve to the sync stamp. The body stays empty. A
  // missing or malformed template falls back to the built-in mapping.
  render(
    template: string | null,
    input: ToDoNoteInput,
    context: ToDoNoteContext,
  ): ToDoNote {
    const rendered =
      template === null ? null : renderTemplate(template, input, context);
    return {
      path: toDoNotePath(input),
      content: rendered ?? ToDoNoteMapper.map(input, context).content,
    };
  },
};

// The note path: the project's todos folder, keyed by the title slug.
function toDoNotePath(input: ToDoNoteInput): string {
  return `Projecten/${input.projectName}/todos/${slugify(input.title)}.md`;
}

// The affiliation list: the project first, then the parent task, then the
// parent to-do when nested — each as a quoted wikilink.
function affiliationValue(input: ToDoNoteInput): string {
  const links = [`[[${input.projectName}]]`, `[[${input.taskLink}]]`];
  if (input.parentTodoLink !== undefined) {
    links.push(`[[${input.parentTodoLink}]]`);
  }
  return `[${links.map((link) => `"${link}"`).join(', ')}]`;
}

// An absent completion stamp is an empty field, not a missing one.
function completedLine(completedAt: string | undefined): string {
  return completedAt === undefined ? 'completed:' : `completed: ${completedAt}`;
}

// Sync-owned fields, in append order when a template omits one.
function managedValues(
  input: ToDoNoteInput,
  context: ToDoNoteContext,
): Map<string, string> {
  return new Map([
    ['affiliation', affiliationValue(input)],
    ['status', context.statusName],
    ['completed', context.completedAt ?? ''],
  ]);
}

// Renders a template into note content, or null when it carries no frontmatter
// block (the caller falls back to the built-in mapping).
function renderTemplate(
  template: string,
  input: ToDoNoteInput,
  context: ToDoNoteContext,
): string | null {
  const lines = template.split('\n');
  if (lines[0] !== '---') {
    return null;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return null;
  }

  const stamped = replaceTimestampPlaceholders(template, context.syncedAt);
  const frontmatter = fillFrontmatterFields(
    stamped.split('\n').slice(0, closing + 1),
    managedValues(input, context),
  );
  return [...frontmatter, ''].join('\n');
}
