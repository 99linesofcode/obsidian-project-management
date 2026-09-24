import { parseChecklist, renderChecklist } from '../Notes/Checklist.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { withBody } from '../Notes/withBody.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface MirrorTodoStatusInput {
  todoPath: string;
  syncedAt: string;
}

// UC: when a to-do note changes, its parent task note's checkbox follows. The
// project and task come from the to-do's path and affiliation; the checklist
// line is located by its link path. Like the checklist sync, it settles: once
// both sides agree there is nothing to write, so the two directions converge
// instead of ping-ponging.
export class MirrorTodoStatusAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(input: MirrorTodoStatusInput): Promise<void> {
    const todo = await this.vault.getNoteByPath(input.todoPath);
    if (!todo) {
      return;
    }

    const parsed = ToDoNoteParser.parse(todo.content);
    if (!parsed) {
      return;
    }

    const projectName = projectFromTodoPath(input.todoPath);
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
      (candidate) => candidate.linkPath === input.todoPath,
    );
    if (!item) {
      return;
    }

    const checked = parsed.status === 'completed';
    if (item.checked === checked) {
      return;
    }

    item.checked = checked;
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
