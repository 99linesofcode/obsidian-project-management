import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { taskStatusFromState } from '../Enums/TaskStatus.js';

export interface TaskNoteContext {
  projectName: string;
  syncedAt: string;
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
    const path = `Projecten/${context.projectName}/taken/${task.remoteId}-${slugify(task.title)}.md`;
    const content = [
      '---',
      'categories: [taken]',
      `url: ${task.url}`,
      `status: ${taskStatusFromState(task.state)}`,
      `affiliation: ["[[${context.projectName}]]"]`,
      `synced: ${context.syncedAt}`,
      '---',
      task.body,
    ].join('\n');
    return { path, content };
  },
};
