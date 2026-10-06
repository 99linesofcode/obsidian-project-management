import { parseChecklist } from '../vault/Checklist.js';
import { parentStemFromAffiliation } from '../shared/projectAffiliation.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { stemOf } from '../shared/stemOf.js';
import { TaskNoteParser } from '../vault/TaskNoteParser.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import type { VaultPort } from '../vault/VaultPort.js';

// One to-do linked from a tracked task's checklist, resolved to its note and
// the task note that owns it.
export interface ToDoItem {
  notePath: string;
  noteContent: string;
  title: string;
  // The parent task's note path; its twin is resolved from the pass's task
  // projection (or the registry), never from a stale note anchor.
  taskNotePath: string;
  // The owning task's vault-owned type: a to-do owned by a slice has no twin
  // to nest under, so it sits top-level (dt-23).
  taskType: string;
  // The owning task's lane, so a top-level to-do lands in its lane's section.
  taskLane: string;
  // The parent to-do's note stem when this to-do nests under another to-do
  // (Todoist indent level 4 — the ceiling); null for a direct task child.
  parentStem: string | null;
}

// Every to-do linked from a task note's checklist, keyed by the task note that
// owns it. The anchor is deliberately NOT read: a to-do's parent twin is
// resolved from the pass's task projection, so a task whose registry record was
// lost still gets its to-dos hung off the twin this pass creates.
// De-duplicated by to-do note path.
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
      // The owning task's type and lane decide a root to-do's placement: a
      // slice has no twin, so its to-do sits top-level in the slice's lane
      // (dt-23).
      const taskParsed = TaskNoteParser.parse(task.content);
      const body = splitFrontmatter(task.content)?.body ?? task.content;
      for (const entry of parseChecklist(body)) {
        if (entry.linkPath === undefined) {
          continue;
        }
        // The checklist link is not the identity: a legacy bare wikilink lost
        // its folder, and a leftover file at the bare stem is not the to-do.
        // Resolve it to the project's to-do folder so the note's real path keys
        // the record and anchors the twin.
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
          parentStem: parentStemFromAffiliation(parsed.affiliation, projectName),
        });
      }
    }

    return [...items.values()];
  }

  // The to-do note a checklist link names. A link already inside the project's
  // to-do folder is its real path; anything else — a legacy bare wikilink above
  // all — is resolved there by stem. A note at the bare stem outside the folder
  // is never the to-do, so it can never key the record or anchor the twin.
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
