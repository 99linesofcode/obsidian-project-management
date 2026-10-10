import { fillFrontmatterFields } from '../../../domain/fillFrontmatterFields.js';
import { projectAffiliationLink } from '../../../domain/projectAffiliation.js';
import { replaceTimestampPlaceholders } from '../../../domain/replaceTimestampPlaceholders.js';
import { slugify } from '../../../domain/slugify.js';

export interface TaskNoteSource {
  type: string;
  title: string;
  body: string;
  createdAt: string | null;
}

export interface TaskNoteContext {
  projectName: string;
  syncedAt: string;
  statusName: string;
  parentLink?: string | null;
}

export interface TaskNote {
  path: string;
  content: string;
}

export const TaskNoteMapper = {
  map(task: TaskNoteSource, context: TaskNoteContext): TaskNote {
    const content = [
      '---',
      'categories: [taken]',
      `type: ${task.type}`,
      `status: ${context.statusName}`,
      `affiliation: ${affiliationValue(context)}`,
      `created: ${createdValue(task, context)}`,
      `synced: ${context.syncedAt}`,
      '---',
      task.body,
    ].join('\n');
    return { path: taskNotePath(task, context), content };
  },

  render(
    template: string | null,
    task: TaskNoteSource,
    context: TaskNoteContext,
  ): TaskNote {
    const rendered =
      template === null ? null : renderTemplate(template, task, context);
    return {
      path: taskNotePath(task, context),
      content: rendered ?? TaskNoteMapper.map(task, context).content,
    };
  },
};

function taskNotePath(task: TaskNoteSource, context: TaskNoteContext): string {
  return `Projecten/${context.projectName}/taken/${slugify(task.title)}.md`;
}

function affiliationValue(context: TaskNoteContext): string {
  const links = [projectAffiliationLink(context.projectName)];
  if (context.parentLink !== undefined && context.parentLink !== null) {
    links.push(`[[${context.parentLink}]]`);
  }
  return `[${links.map((link) => `"${link}"`).join(', ')}]`;
}

function createdValue(task: TaskNoteSource, context: TaskNoteContext): string {
  if (task.createdAt !== null && task.createdAt !== '') {
    return task.createdAt;
  }
  return context.syncedAt.slice(0, 10);
}

function managedValues(
  task: TaskNoteSource,
  context: TaskNoteContext,
): Map<string, string> {
  return new Map([
    ['type', task.type],
    ['status', context.statusName],
    ['affiliation', affiliationValue(context)],
    ['synced', context.syncedAt],
  ]);
}

function renderTemplate(
  template: string,
  task: TaskNoteSource,
  context: TaskNoteContext,
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
    managedValues(task, context),
  );
  return [...frontmatter, task.body].join('\n');
}
