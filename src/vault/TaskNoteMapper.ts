import { fillFrontmatterFields } from './fillFrontmatterFields.js';
import { projectAffiliationLink } from '../shared/projectAffiliation.js';
import { replaceTimestampPlaceholders } from './replaceTimestampPlaceholders.js';
import { slugify } from '../shared/slugify.js';

// Re-exported so note-facing callers keep importing slugify from the vault
// module; the implementation lives in shared so the shared kernel never
// depends on a vault module.
export { slugify };

// The task fields a note is rendered from. Structural, so the canonical
// TaskData satisfies it directly. The id is deliberately absent (dt-20): the
// note no longer carries a machine id, and the registry owns identity.
export interface TaskNoteSource {
  type: string;
  title: string;
  body: string;
  // The vault `created` stamp, or null for a fresh note (the sync stamp is
  // used then).
  createdAt: string | null;
}

export interface TaskNoteContext {
  projectName: string;
  syncedAt: string;
  // The project's Status option name the task sits in — written verbatim.
  statusName: string;
  // The parent note's stem when the task is nested (a slice or parent task);
  // null/absent for a top-level task. The affiliation is rendered project-first,
  // then this link — the vault's presentation of the parent relation.
  parentLink?: string | null;
}

export interface TaskNote {
  path: string;
  content: string;
}

// Derives the user-facing title from a note's filename: strips a legacy
// `<remoteId>-` prefix and .md, then turns the slug's dashes back into spaces.
// Lossy — the slug cannot recover the original casing or punctuation — but
// readable. New note names are slug-only, so the prefix is usually absent.
export function titleFromNotePath(notePath: string, remoteId: number): string {
  const basename = notePath.split('/').pop() ?? '';
  const withoutExt = basename.replace(/\.md$/, '');
  const withoutId = withoutExt.replace(new RegExp(`^${remoteId}-`), '');
  return withoutId.replace(/-/g, ' ');
}

// Maps a task onto a task note. The name is the title slug — filenames carry
// zero identity weight now, so no remote id prefixes a new note; the caller
// resolves a collision through freePath. The body is the note's body verbatim.
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

  // Renders the note through a vault template: the template's frontmatter is
  // kept verbatim (vault-owned fields like categories and tags), the sync
  // fields are filled in, {{date}}/{{time}} resolve to the sync stamp, and
  // the body is the issue body verbatim — the reconcile hash compares the
  // remote body, so template body content would break it. A missing or
  // malformed template falls back to the built-in mapping.
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

// The note path: the project's taken folder, keyed by the title slug.
function taskNotePath(task: TaskNoteSource, context: TaskNoteContext): string {
  return `Projecten/${context.projectName}/taken/${slugify(task.title)}.md`;
}

// The affiliation list: the project first, then the parent note when nested.
// The parent is a bare stem link (the affiliation reader strips the wikilink and
// resolves the stem through the registry), matching the to-do affiliation shape.
function affiliationValue(context: TaskNoteContext): string {
  const links = [projectAffiliationLink(context.projectName)];
  if (context.parentLink !== undefined && context.parentLink !== null) {
    links.push(`[[${context.parentLink}]]`);
  }
  return `[${links.map((link) => `"${link}"`).join(', ')}]`;
}

// The `created` value: the vault's own stamp when the note has one, otherwise
// the sync date — never a bare empty field on a new note.
function createdValue(task: TaskNoteSource, context: TaskNoteContext): string {
  if (task.createdAt !== null && task.createdAt !== '') {
    return task.createdAt;
  }
  return context.syncedAt.slice(0, 10);
}

// Sync-owned frontmatter fields, in append order when a template omits one.
// `id` is deliberately not managed (dt-20): the note carries no machine id.
// `created` is left to the template's {{date}} placeholder and the built-in
// mapping, so a vault-authored created stamp survives the template path.
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

// Renders a template into note content, or null when the template carries no
// frontmatter block (the caller falls back to the built-in mapping).
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
