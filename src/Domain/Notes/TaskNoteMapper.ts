import type { TaskData } from '../DataTransferObjects/TaskData.js';

export interface TaskNoteContext {
  projectName: string;
  syncedAt: string;
  // The project's Status option name the task sits in — written verbatim.
  statusName: string;
}

export interface TaskNote {
  path: string;
  content: string;
}

// Sanitises a title into a filename slug: lowercase, spaces to dashes, strip
// everything outside [a-z0-9-], collapse runs of dashes, trim the ends.
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Derives the user-facing title from a note's filename: strips the remote id
// prefix and .md, then turns the slug's dashes back into spaces. Lossy — the
// slug cannot recover the original casing or punctuation — but readable.
export function titleFromNotePath(notePath: string, remoteId: number): string {
  const basename = notePath.split('/').pop() ?? '';
  const withoutExt = basename.replace(/\.md$/, '');
  const withoutId = withoutExt.replace(new RegExp(`^${remoteId}-`), '');
  return withoutId.replace(/-/g, ' ');
}

// Maps a remote task onto a task note. The remote id lives only in the
// filename; the body is the note's body verbatim.
export const TaskNoteMapper = {
  map(task: TaskData, context: TaskNoteContext): TaskNote {
    const content = [
      '---',
      'categories: [taken]',
      `url: ${task.url}`,
      `status: ${context.statusName}`,
      `affiliation: ["[[${context.projectName}]]"]`,
      `synced: ${context.syncedAt}`,
      '---',
      task.body,
    ].join('\n');
    return { path: taskNotePath(task, context), content };
  },

  // Renders the note through a vault template: the template's frontmatter is
  // kept verbatim (vault-owned fields like categories and tags), the sync
  // fields are filled in, {{date}}/{{time}} resolve to the sync stamp, and
  // the body is the issue body verbatim — the reconcile hash compares the
  // remote body, so template body content would break it. A missing or
  // malformed template falls back to the built-in mapping.
  render(
    template: string | null,
    task: TaskData,
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

// The note path: the project's taken folder, keyed by remote id + title slug.
function taskNotePath(task: TaskData, context: TaskNoteContext): string {
  return `Projecten/${context.projectName}/taken/${task.remoteId}-${slugify(task.title)}.md`;
}

// Sync-owned frontmatter fields, in append order when a template omits one.
const MANAGED_FIELD_ORDER = ['url', 'status', 'synced', 'affiliation'];

function managedFieldValues(
  task: TaskData,
  context: TaskNoteContext,
): Map<string, string> {
  return new Map([
    ['url', task.url],
    ['status', context.statusName],
    ['synced', context.syncedAt],
    ['affiliation', `["[[${context.projectName}]]"]`],
  ]);
}

// Renders a template into note content, or null when the template carries no
// frontmatter block (the caller falls back to the built-in mapping).
function renderTemplate(
  template: string,
  task: TaskData,
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
  const frontmatter = fillManagedFields(
    stamped.split('\n').slice(0, closing + 1),
    task,
    context,
  );
  return [...frontmatter, task.body].join('\n');
}

// Resolves the template placeholders to the sync stamp's date and time.
function replaceTimestampPlaceholders(
  template: string,
  syncedAt: string,
): string {
  return template
    .replaceAll('{{date}}', syncedAt.slice(0, 10))
    .replaceAll('{{time}}', syncedAt.slice(11, 16));
}

// Fills the sync-owned fields into the frontmatter: a field the template
// declares (even empty) gets its value in place; a missing one is appended
// before the closing delimiter.
function fillManagedFields(
  lines: string[],
  task: TaskData,
  context: TaskNoteContext,
): string[] {
  const values = managedFieldValues(task, context);
  const filled = [...lines];
  const missing: string[] = [];

  for (const key of MANAGED_FIELD_ORDER) {
    const index = filled.findIndex((line) => line.startsWith(`${key}:`));
    if (index === -1) {
      missing.push(key);
      continue;
    }
    filled[index] = `${key}: ${values.get(key)}`;
  }

  const appended = missing.map((key) => `${key}: ${values.get(key)}`);
  filled.splice(filled.length - 1, 0, ...appended);
  return filled;
}
