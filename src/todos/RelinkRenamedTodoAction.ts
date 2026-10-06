import { parseChecklist, renderChecklist } from '../vault/Checklist.js';
import { projectFromTodoPath } from './projectFromTodoPath.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { taskLinkFromAffiliation } from '../shared/taskLinkFromAffiliation.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import { withBody } from '../vault/withBody.js';
import type { SyncStatePort } from '../registry/SyncStatePort.js';
import type { VaultPort } from '../vault/VaultPort.js';

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
    await this.moveRecord(input.oldPath, input.newPath);

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

  // Moves the to-do's registry record to the new path. The record is keyed by
  // its uuid, so this is a notePath update, not a re-key; the mirror handles
  // and base travel with it.
  private async moveRecord(
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const record = await this.syncState.findByNotePath(oldPath);
    if (record) {
      await this.syncState.setEntity({ ...record, notePath: newPath });
    }
  }
}
