import { parseChecklist, renderChecklist } from '../Notes/Checklist.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { withBody } from '../Notes/withBody.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface RelinkRenamedTodoInput {
  oldPath: string;
  newPath: string;
  syncedAt: string;
}

// UC: when a to-do note is renamed by hand, its parent task note's checklist
// line follows. The parent and task come from the to-do's new path and
// affiliation; the line is located by the old link path. A rename the checklist
// sync itself performed already updated the line, so no line matches the old
// path and the action no-ops — that is what lets the rename echo settle.
export class RelinkRenamedTodoAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: RelinkRenamedTodoInput): Promise<void> {
    const todo = await this.vault.getNoteByPath(input.newPath);
    if (!todo) {
      return;
    }

    const parsed = ToDoNoteParser.parse(todo.content);
    if (!parsed) {
      return;
    }

    const projectName = projectFromTodoPath(input.newPath);
    if (projectName === null) {
      return;
    }
    const taskLink = taskLinkFromAffiliation(parsed.affiliation, projectName);
    if (taskLink === null) {
      return;
    }

    const taskPath = `Projecten/${projectName}/taken/${taskLink}.md`;
    const task = await this.vault.getNoteByPath(taskPath);
    if (!task) {
      return;
    }

    const body = splitFrontmatter(task.content)?.body ?? task.content;
    const items = parseChecklist(body);
    const item = items.find(
      (candidate) => candidate.linkPath === input.oldPath,
    );
    if (!item) {
      return;
    }

    item.linkPath = input.newPath;
    await this.vault.writeNote(
      taskPath,
      withBody(task.content, renderChecklist(body, items)),
    );
  }
}

// To-dos live at Projecten/<project>/todos/<file>.md.
function projectFromTodoPath(path: string): string | null {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' || segments[2] !== 'todos') {
    return null;
  }
  return segments[1] ?? null;
}

// The affiliation lists project first, then the parent task; the first link
// that is not the project is the task.
function taskLinkFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  for (const link of affiliation) {
    const target = link.replace(/^\[\[/, '').replace(/\]\]$/, '');
    if (target !== projectName) {
      return target;
    }
  }
  return null;
}
