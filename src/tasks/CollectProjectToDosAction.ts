import { parseChecklist } from '../vault/Checklist.js';
import { parentStemFromAffiliation } from '../shared/projectAffiliation.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { stemOf } from '../shared/stemOf.js';
import { TaskNoteParser } from '../vault/TaskNoteParser.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface ToDoItem {
  notePath: string;
  noteContent: string;
  title: string;
  taskNotePath: string;
  taskType: string;
  taskLane: string;
  parentStem: string | null;
}

export class CollectProjectToDosAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(projectName: string): Promise<ToDoItem[]> {
    const items = new Map<string, ToDoItem>();
    const folder = `Projecten/${projectName}/taken`;

    for (const taskPath of await this.vault.listNotesInFolder(folder)) {
      const task = await this.vault.getNoteByPath(taskPath);
      if (!task) {
        continue;
      }
      const taskParsed = TaskNoteParser.parse(task.content);
      const body = splitFrontmatter(task.content)?.body ?? task.content;
      for (const entry of parseChecklist(body)) {
        if (entry.linkPath === undefined) {
          continue;
        }
        const notePath = await this.resolveToDoPath(
          entry.linkPath,
          projectName,
        );
        if (notePath === null) {
          continue;
        }
        const todo = await this.vault.getNoteByPath(notePath);
        if (!todo) {
          continue;
        }
        const parsed = ToDoNoteParser.parse(todo.content);
        if (!parsed) {
          continue;
        }
        items.set(notePath, {
          notePath,
          noteContent: todo.content,
          title: entry.text,
          taskNotePath: taskPath,
          taskType: taskParsed?.type ?? '',
          taskLane: taskParsed?.status ?? '',
          parentStem: parentStemFromAffiliation(
            parsed.affiliation,
            projectName,
          ),
        });
      }
    }

    return [...items.values()];
  }

  private async resolveToDoPath(
    linkPath: string,
    projectName: string,
  ): Promise<string | null> {
    const folder = `Projecten/${projectName}/todos/`;
    const candidate =
      linkPath.startsWith(folder) && linkPath.endsWith('.md')
        ? linkPath
        : `${folder}${stemOf(linkPath)}.md`;
    return (await this.vault.getNoteByPath(candidate)) === null
      ? null
      : candidate;
  }
}
