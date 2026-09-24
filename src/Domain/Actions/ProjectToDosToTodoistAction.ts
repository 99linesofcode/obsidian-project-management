import { parseChecklist } from '../Notes/Checklist.js';
import { hash } from '../Notes/hash.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface ProjectToDosToTodoistInput {
  projectName: string;
  projectId: string;
  syncedAt: string;
}

// Every to-do carries the derived `todo` label (dt-09); the label set is
// overwritten on drift, never free-form.
const TODO_LABEL = 'todo';

// One to-do linked from a tracked task's checklist, resolved to its note and
// the twin of the task that owns it.
interface ToDoItem {
  notePath: string;
  noteContent: string;
  title: string;
  taskTwinId: string;
  // The parent to-do's note stem when this to-do nests under another to-do
  // (Todoist indent level 4 — the ceiling); null for a direct task child.
  parentStem: string | null;
}

// The projection's desired shape, the thing the snapshot hash covers. A to-do
// is always a subtask, so it has no controlled section: it inherits its
// parent's (dt-02), which is why section never enters the hash (empty).
interface DesiredToDo {
  content: string;
  labels: string[];
  parentId: string;
  isCompleted: boolean;
}

// UC: project the vault's to-dos onto their Todoist twins (t4). A to-do is
// discovered through the checklist of a tracked task whose note carries a
// `todoist` twin anchor — a to-do whose task has no twin does not project. It
// becomes a `todo`-labeled subtask under that task's twin; a to-do nested under
// another to-do (its affiliation's third link) nests under the parent to-do's
// twin instead, at Todoist's fourth indent level. Roots are projected before
// their nested children so a child can find its parent's twin id.
//
// Completion flows both ways. This action owns the vault -> Todoist push: a
// to-do the vault has completed since the last sync closes its twin, and a
// to-do the vault has reopened since the last sync reopens it. A completion
// that moved only on the remote side is left to ApplyTodoistCompletionAction,
// which the scheduler runs before this action; by the time the projection runs
// the vault has already absorbed remote changes, so the vault's completion is
// the settled truth to push. The vault is the source of truth for content and
// structure; drift is overwritten (dt-09). Every write stamps the snapshot hash
// and completion bit (dt-08) so the next poll never reads our own write as a
// remote change.
//
// Idempotence: the desired shape is compared to the live twin before writing,
// so a settled project performs no write at all.
export class ProjectToDosToTodoistAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
  ) {}

  async execute(input: ProjectToDosToTodoistInput): Promise<void> {
    const items = await this.collectItems(input.projectName);
    if (items.length === 0) {
      return;
    }

    const active = await this.taskManager.fetchActiveTasks(input.projectId);
    const activeById = new Map(active.map((task) => [task.id, task]));

    const roots = items.filter((item) => item.parentStem === null);
    const nested = items.filter((item) => item.parentStem !== null);

    // Roots first: a nested to-do needs its parent to-do's twin id, which a
    // root projected this tick records in the map below.
    const twinIdByStem = new Map<string, string>();
    for (const item of roots) {
      const id = await this.projectItem(
        item,
        item.taskTwinId,
        activeById,
        input.projectId,
      );
      twinIdByStem.set(stemOf(item.notePath), id);
    }

    for (const item of nested) {
      const parentId =
        twinIdByStem.get(item.parentStem!) ??
        (await this.anchorId(
          `Projecten/${input.projectName}/todos/${item.parentStem}.md`,
        ));
      if (parentId === null) {
        // The parent to-do has no twin yet; the child waits for the next tick.
        continue;
      }
      await this.projectItem(item, parentId, activeById, input.projectId);
    }
  }

  // Every to-do linked from the checklist of a task note that carries a
  // `todoist` twin anchor. De-duplicated by note path, so a to-do linked twice
  // is projected once.
  private async collectItems(projectName: string): Promise<ToDoItem[]> {
    const items = new Map<string, ToDoItem>();
    const folder = `Projecten/${projectName}/taken`;

    for (const taskPath of await this.vault.listNotesInFolder(folder)) {
      const task = await this.vault.getNoteByPath(taskPath);
      if (!task) {
        continue;
      }
      const taskTwinId = anchorOf(task.content);
      // A task with no twin has nowhere to hang its to-dos.
      if (taskTwinId === null) {
        continue;
      }
      const body = splitFrontmatter(task.content)?.body ?? task.content;
      for (const item of parseChecklist(body)) {
        if (item.linkPath === undefined) {
          continue;
        }
        const todo = await this.vault.getNoteByPath(item.linkPath);
        if (!todo) {
          continue;
        }
        const parsed = ToDoNoteParser.parse(todo.content);
        if (!parsed) {
          continue;
        }
        items.set(item.linkPath, {
          notePath: item.linkPath,
          noteContent: todo.content,
          title: item.text,
          taskTwinId,
          parentStem: parentStemFromAffiliation(
            parsed.affiliation,
            projectName,
          ),
        });
      }
    }

    return [...items.values()];
  }

  // Projects one to-do and returns its Todoist task id. A settled twin (the
  // desired shape already matches and no vault-side completion moved) is left
  // untouched; otherwise only the drifted fields are written, and the snapshot
  // is stamped after the write.
  private async projectItem(
    item: ToDoItem,
    parentId: string,
    activeById: Map<string, TodoistTaskData>,
    projectId: string,
  ): Promise<string> {
    const parsed = ToDoNoteParser.parse(item.noteContent);
    const desired: DesiredToDo = {
      content: item.title,
      labels: [TODO_LABEL],
      parentId,
      isCompleted: parsed?.status === 'completed',
    };
    const stored = await this.syncState.getTodoistState(item.notePath);
    const current = stored ? activeById.get(stored.todoistId) : undefined;
    const storedCompleted = stored?.lastSyncedCompleted ?? false;

    if (!stored) {
      await this.taskManager.ensureLabel(TODO_LABEL);
      const created = await this.taskManager.createTask({
        projectId,
        parentId,
        content: desired.content,
        labels: desired.labels,
      });
      await stampFrontmatterField(
        this.vault,
        item.notePath,
        item.noteContent,
        'todoist',
        created.id,
      );
      if (desired.isCompleted) {
        await this.taskManager.setTaskCompleted(created.id, true);
      }
      await this.stampState(item.notePath, created.id, desired);
      return created.id;
    }

    const id = stored.todoistId;
    // The twin is absent from the active set: completed (or gone). A vault-side
    // completion change is pushed; a remote change is left to the apply action.
    if (!current) {
      if (desired.isCompleted !== storedCompleted) {
        await this.taskManager.setTaskCompleted(id, desired.isCompleted);
        await this.stampState(item.notePath, id, desired);
      }
      return id;
    }

    const contentDrift =
      current.content !== desired.content ||
      !sameLabels(current.labels, desired.labels);
    const parentDrift = current.parentId !== desired.parentId;
    // Only a vault-side completion change moves the twin; a twin that already
    // matches the vault (a remote reopen the apply action resolved) does not.
    const completionDrift =
      desired.isCompleted !== storedCompleted &&
      current.isCompleted !== desired.isCompleted;

    if (!contentDrift && !parentDrift && !completionDrift) {
      return id;
    }

    if (contentDrift) {
      await this.taskManager.ensureLabel(TODO_LABEL);
      await this.taskManager.updateTask(id, {
        content: desired.content,
        labels: desired.labels,
      });
    }
    if (parentDrift) {
      await this.taskManager.moveTask(id, { parentId: desired.parentId });
    }
    if (completionDrift) {
      await this.taskManager.setTaskCompleted(id, desired.isCompleted);
    }
    await this.stampState(item.notePath, id, desired);
    return id;
  }

  // A note's `todoist` twin anchor, or null when it carries none.
  private async anchorId(notePath: string): Promise<string | null> {
    const note = await this.vault.getNoteByPath(notePath);
    return note === null ? null : anchorOf(note.content);
  }

  private async stampState(
    notePath: string,
    todoistId: string,
    desired: DesiredToDo,
  ): Promise<void> {
    await this.syncState.setTodoistState(notePath, {
      todoistId,
      notePath,
      lastSyncedHash: snapshotHash(desired),
      lastSyncedCompleted: desired.isCompleted,
      lastSyncedContent: desired.content,
      // A to-do is always a subtask: it inherits its parent's section, so the
      // lane is not a controlled field for it (dt-02).
      lastSyncedLane: null,
      lastSyncedParent: desired.parentId,
    });
  }
}

// A note's `todoist` frontmatter anchor, or null when absent or empty.
function anchorOf(content: string): string | null {
  const anchor = splitFrontmatter(content)?.fields.get('todoist') ?? '';
  return anchor === '' ? null : anchor;
}

// The snapshot hash (dt-08): content, labels, parent and completion. Labels are
// sorted so their order never reads as a change; the section stays empty
// because a subtask inherits its parent's (dt-02), so it is not a controlled
// field here.
function snapshotHash(desired: DesiredToDo): string {
  return hash(
    [
      desired.content,
      [...desired.labels].sort().join(','),
      '',
      desired.parentId,
      desired.isCompleted ? '1' : '0',
    ].join('\n'),
  );
}

// The affiliation lists the project first, then the parent task, then — when
// nested — the parent to-do. The second non-project link is the parent to-do's
// stem; a to-do with no parent link returns null.
function parentStemFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  const targets = affiliation
    .map(stripLink)
    .filter((target) => target !== projectName);
  return targets[1] ?? null;
}

function stripLink(link: string): string {
  return link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
}

// A note's filename stem: its basename without the .md extension.
function stemOf(path: string): string {
  const basename = path.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((label, index) => label === sortedB[index]);
}
