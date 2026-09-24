import { slugify } from './TaskNoteMapper.js';

export interface CapturedTaskNoteInput {
  title: string;
  projectName: string;
  // The slice note's link target when the capture is nested under a slice;
  // null for a top-level capture.
  sliceLink: string | null;
  todoistId: string;
}

export interface CapturedTaskNoteContext {
  syncedAt: string;
  // The lane the item's section maps to; the default lane when it has none.
  statusName: string;
}

export interface CapturedTaskNote {
  path: string;
  content: string;
}

// Maps a Todoist-created item onto a captured draft task note (dt-06). It is a
// task note without a GitHub issue: no `url` frontmatter and no Status record —
// the `todoist` anchor is its identity and the TodoistState record is its
// bookkeeping. The body stays empty; a draft is a placeholder the user promotes
// through the existing UC21 flow. Deliberately not template-rendered: the task
// template carries a `url` field, and a captured draft must not advertise one.
export const CapturedTaskNoteMapper = {
  map(
    input: CapturedTaskNoteInput,
    context: CapturedTaskNoteContext,
  ): CapturedTaskNote {
    const content = [
      '---',
      'categories: [taken]',
      `status: ${context.statusName}`,
      `affiliation: ${affiliationValue(input)}`,
      `synced: ${context.syncedAt}`,
      `todoist: ${input.todoistId}`,
      '---',
      '',
    ].join('\n');
    return { path: capturedTaskNotePath(input), content };
  },
};

// The note path: the project's taken folder, keyed by the title slug. No remote
// id prefixes the name — a captured draft has no GitHub issue yet.
function capturedTaskNotePath(input: CapturedTaskNoteInput): string {
  return `Projecten/${input.projectName}/taken/${slugify(input.title)}.md`;
}

// The affiliation list: the project first, then the slice when nested.
function affiliationValue(input: CapturedTaskNoteInput): string {
  const links = [`[[${input.projectName}]]`];
  if (input.sliceLink !== null) {
    links.push(`[[${input.sliceLink}]]`);
  }
  return `[${links.map((link) => `"${link}"`).join(', ')}]`;
}
