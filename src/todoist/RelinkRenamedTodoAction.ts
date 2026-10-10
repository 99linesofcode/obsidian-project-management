import { parseChecklist, renderChecklist } from '../vault/Checklist.js';
import { projectFromTodoPath } from '../todos/projectFromTodoPath.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { taskLinkFromAffiliation } from '../shared/taskLinkFromAffiliation.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import { withBody } from '../vault/withBody.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface RelinkRenamedTodoInput {
  oldPath: string;
  newPath: string;
  syncedAt: string;
}

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

  private async moveRecord(oldPath: string, newPath: string): Promise<void> {
    const record = await this.syncState.findByNotePath(oldPath);
    if (record) {
      await this.syncState.setEntity({ ...record, notePath: newPath });
    }
  }
}
