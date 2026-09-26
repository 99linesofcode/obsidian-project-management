import { parseChecklist, renderChecklist } from '../Notes/Checklist.js';
import { projectFromTodoPath } from '../Notes/projectFromTodoPath.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { withBody } from '../Notes/withBody.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
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
// path and the action no-ops — that is what lets the rename echo settle. The
// to-do's TodoistState record follows too (t5), so a rename keeps its twin
// anchor rather than stranding it at the old path.
export class RelinkRenamedTodoAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: RelinkRenamedTodoInput): Promise<void> {
    await this.moveTodoistState(input.oldPath, input.newPath);

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

  // Re-keys the to-do's TodoistState to the new path. The adapter evicts the
  // record's old key (one record per todoistId), so this is a move, not a copy.
  private async moveTodoistState(
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const state = await this.syncState.getTodoistState(oldPath);
    if (state) {
      await this.syncState.setTodoistState(newPath, {
        ...state,
        notePath: newPath,
      });
    }
  }
}
