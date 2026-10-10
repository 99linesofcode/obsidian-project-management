import { slugify } from '../../../domain/slugify.js';
import { fillFrontmatterFields } from '../../../domain/fillFrontmatterFields.js';
import { projectAffiliationLink } from '../../../domain/projectAffiliation.js';
import { replaceTimestampPlaceholders } from '../../../domain/replaceTimestampPlaceholders.js';

export interface ToDoNoteInput {
  title: string;
  projectName: string;
  taskLink: string;
  parentTodoLink?: string;
}

export interface ToDoNoteContext {
  syncedAt: string;
  statusName: 'open' | 'completed';
  completedAt?: string;
}

export interface ToDoNote {
  path: string;
  content: string;
}

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

function toDoNotePath(input: ToDoNoteInput): string {
  return `Projecten/${input.projectName}/todos/${slugify(input.title)}.md`;
}

function affiliationValue(input: ToDoNoteInput): string {
  const links = [
    projectAffiliationLink(input.projectName),
    `[[${input.taskLink}]]`,
  ];
  if (input.parentTodoLink !== undefined) {
    links.push(`[[${input.parentTodoLink}]]`);
  }
  return `[${links.map((link) => `"${link}"`).join(', ')}]`;
}

function completedLine(completedAt: string | undefined): string {
  return completedAt === undefined ? 'completed:' : `completed: ${completedAt}`;
}

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
