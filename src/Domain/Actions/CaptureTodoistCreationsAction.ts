import { CapturedTaskNoteMapper } from '../Notes/CapturedTaskNoteMapper.js';
import { parseChecklist, renderChecklist } from '../Notes/Checklist.js';
import { hash } from '../Notes/hash.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import { ToDoNoteMapper } from '../Notes/ToDoNoteMapper.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { withBody } from '../Notes/withBody.js';
import type { TodoistStateData } from '../DataTransferObjects/TodoistStateData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface CaptureTodoistCreationsInput {
  projectName: string;
  projectId: string;
  syncedAt: string;
}

// The label the task projection puts on a slice twin (dt-09), used to tell a
// slice parent from an ordinary task parent when classifying a subtask.
const SLICE_LABEL = 'slice';

// UC: capture Todoist-created items into the vault (dt-06). A fetched item with
// no anchored note is a creation; its kind follows its position in Todoist:
//
//   - top-level          -> captured task note affiliated to the project
//   - under a slice twin -> captured task note affiliated to that slice
//   - under a task twin  -> to-do note linked from that task's checklist
//   - under a to-do twin -> nested to-do (Todoist's fourth indent level)
//
// A captured task note is a draft: no GitHub issue, no `url` frontmatter, no
// Status record — the `todoist` anchor and the TodoistState record are its
// identity. Todoist-created items carry no type label until the user promotes
// them through the existing UC21 flow, so no type is invented here. The status
// follows the item's section (the lane whose section it sits in); a section-less
// item lands in the default lane, a completed one in the done lane. The anchor
// and the snapshot are stamped immediately (the echo guard): the next poll must
// read the item as anchored, not as a fresh creation.
//
// Nothing is ever written back to Todoist from here: no issue, project or
// section is created from the Todoist side.
export class CaptureTodoistCreationsAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly todoTemplatePath: string,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: CaptureTodoistCreationsInput): Promise<void> {
    const projectState = await this.syncState.getTodoistProjectState(
      input.projectName,
    );
    const sections = projectState?.sections ?? {};
    const since = projectState?.lastCompletedPoll || input.syncedAt;

    const completed = await this.taskManager.fetchCompletedTasks(
      input.projectId,
      since,
    );
    const active = await this.taskManager.fetchActiveTasks(input.projectId);
    // Active last, so a reopened item reads as active.
    const items = dedupeById([...completed, ...active]);
    if (items.length === 0) {
      return;
    }

    const states = (await this.syncState.listTodoistStates()).filter((state) =>
      isMirroredPath(state.notePath, input.projectName),
    );
    const anchored = new Set(states.map((state) => state.todoistId));
    const notePathById = new Map(
      states.map((state) => [state.todoistId, state.notePath] as const),
    );

    const identity = await this.syncState.getIdentity(input.projectName);
    const hasLanes = (identity?.statusOptions.length ?? 0) > 0;
    const defaultLane = identity?.statusOptions[0]?.name ?? null;

    const byId = new Map(items.map((item) => [item.id, item] as const));
    // Parents before children: a captured parent must carry its anchor and
    // bookkeeping before its child can affiliate to it.
    const ordered = [...items].sort(
      (a, b) => depthOf(a, byId) - depthOf(b, byId),
    );
    const template = await this.readTemplate();

    for (const item of ordered) {
      if (anchored.has(item.id)) {
        continue;
      }
      const parentId = item.parentId;
      if (parentId === null) {
        const path = await this.createCapturedTask(
          item,
          null,
          input,
          sections,
          hasLanes,
          defaultLane,
        );
        // Record the new anchor so a child captured later in this same pass can
        // affiliate to it.
        notePathById.set(item.id, path);
        continue;
      }

      const parentPath = notePathById.get(parentId);
      if (parentPath === undefined) {
        // The parent has no anchored note (it is not part of this pass); the
        // child waits for the next tick.
        continue;
      }
      const parent = byId.get(parentId);
      const underSlice =
        !isToDoPath(parentPath, input.projectName) &&
        parent?.labels.includes(SLICE_LABEL) === true;
      const path = underSlice
        ? await this.createCapturedTask(
            item,
            stemOf(parentPath),
            input,
            sections,
            hasLanes,
            defaultLane,
          )
        : await this.createToDo(item, parentPath, input, template);
      if (path !== null) {
        notePathById.set(item.id, path);
      }
    }
  }

  // A captured draft task note: affiliated to the project, or to the slice it
  // was created under. The status is the lane its section maps to.
  private async createCapturedTask(
    item: TodoistTaskData,
    sliceLink: string | null,
    input: CaptureTodoistCreationsInput,
    sections: Record<string, string>,
    hasLanes: boolean,
    defaultLane: string | null,
  ): Promise<string> {
    const statusName = this.laneForItem(item, sections, hasLanes, defaultLane);
    const rendered = CapturedTaskNoteMapper.map(
      {
        title: item.content,
        projectName: input.projectName,
        sliceLink,
        todoistId: item.id,
      },
      { syncedAt: input.syncedAt, statusName },
    );
    const path = await this.freePath(rendered.path);
    await this.vault.createNote(path, rendered.content);
    // The lane is controlled only for a top-level task (a subtask inherits its
    // parent's section, dt-02).
    const lane = hasLanes && item.parentId === null ? statusName : null;
    await this.stampCreation(path, item, lane);
    return path;
  }

  // A to-do note plus the checklist line that links it from its task. The line
  // is what the to-do projection follows to find the twin; the note's
  // affiliation carries the true parent (nested to-dos included). Returns null
  // when the parent's task link cannot be resolved yet.
  private async createToDo(
    item: TodoistTaskData,
    parentPath: string,
    input: CaptureTodoistCreationsInput,
    template: string | null,
  ): Promise<string | null> {
    let taskLink: string;
    let parentTodoLink: string | undefined;
    if (isToDoPath(parentPath, input.projectName)) {
      const parentNote = await this.vault.getNoteByPath(parentPath);
      const parsed = parentNote
        ? ToDoNoteParser.parse(parentNote.content)
        : null;
      const parentTask = parsed
        ? taskLinkFromAffiliation(parsed.affiliation, input.projectName)
        : null;
      if (parentTask === null) {
        return null;
      }
      taskLink = parentTask;
      parentTodoLink = stemOf(parentPath);
    } else {
      taskLink = stemOf(parentPath);
    }

    const rendered = ToDoNoteMapper.render(
      template,
      {
        title: item.content,
        projectName: input.projectName,
        taskLink,
        ...(parentTodoLink === undefined ? {} : { parentTodoLink }),
      },
      item.isCompleted
        ? {
            syncedAt: input.syncedAt,
            statusName: 'completed',
            completedAt: input.syncedAt,
          }
        : { syncedAt: input.syncedAt, statusName: 'open' },
    );
    const path = await this.freePath(rendered.path);
    await this.vault.createNote(path, rendered.content);
    await stampFrontmatterField(
      this.vault,
      path,
      rendered.content,
      'todoist',
      item.id,
    );
    await this.addChecklistItem(
      `Projecten/${input.projectName}/taken/${taskLink}.md`,
      item,
      path,
    );
    // A to-do is a subtask: its lane is inherited, so it is never controlled.
    await this.stampCreation(path, item, null);
    return path;
  }

  // Adds the to-do's checklist line to its task note. The line is appended, so
  // the task's existing checklist is preserved; the affiliation, not the line's
  // indent, carries the true parent for nesting.
  private async addChecklistItem(
    taskPath: string,
    item: TodoistTaskData,
    todoPath: string,
  ): Promise<void> {
    const task = await this.vault.getNoteByPath(taskPath);
    if (!task) {
      return;
    }
    const body = splitFrontmatter(task.content)?.body ?? task.content;
    const items = parseChecklist(body);
    items.push({
      text: item.content,
      checked: item.isCompleted,
      depth: 0,
      linkPath: todoPath,
    });
    await this.vault.writeNote(
      taskPath,
      withBody(task.content, renderChecklist(body, items)),
    );
  }

  private async stampCreation(
    notePath: string,
    item: TodoistTaskData,
    lane: string | null,
  ): Promise<void> {
    const state: TodoistStateData = {
      todoistId: item.id,
      notePath,
      lastSyncedHash: creationHash(item, lane !== null),
      lastSyncedCompleted: item.isCompleted,
      lastSyncedContent: item.content,
      lastSyncedLane: lane,
      lastSyncedParent: item.parentId,
    };
    await this.syncState.setTodoistState(notePath, state);
  }

  // The lane a new item's status starts in: its section's lane; a completed
  // item is done (dt-07); a section-less item is the default lane.
  private laneForItem(
    item: TodoistTaskData,
    sections: Record<string, string>,
    hasLanes: boolean,
    defaultLane: string | null,
  ): string {
    if (!hasLanes) {
      return '';
    }
    if (item.isCompleted) {
      return this.doneOptionName;
    }
    return laneForSection(sections, item.sectionId) ?? defaultLane ?? '';
  }

  private async readTemplate(): Promise<string | null> {
    const note = await this.vault.getNoteByPath(this.todoTemplatePath);
    return note?.content ?? null;
  }

  // Suffixes -2, -3, … until the note path is free, mirroring the checklist
  // sync's collision handling.
  private async freePath(base: string): Promise<string> {
    if (!(await this.vault.getNoteByPath(base))) {
      return base;
    }
    const stem = base.replace(/\.md$/, '');
    let suffix = 2;
    while (await this.vault.getNoteByPath(`${stem}-${suffix}.md`)) {
      suffix++;
    }
    return `${stem}-${suffix}.md`;
  }
}

// The snapshot hash (dt-08): content, labels, section, parent and completion.
// The section enters only for a top-level item, matching the projection.
function creationHash(item: TodoistTaskData, topLevel: boolean): string {
  return hash(
    [
      item.content,
      [...item.labels].sort().join(','),
      topLevel ? (item.sectionId ?? '') : '',
      item.parentId ?? '',
      item.isCompleted ? '1' : '0',
    ].join('\n'),
  );
}

function laneForSection(
  sections: Record<string, string>,
  sectionId: string | null,
): string | null {
  if (sectionId === null) {
    return null;
  }
  for (const [lane, id] of Object.entries(sections)) {
    if (id === sectionId) {
      return lane;
    }
  }
  return null;
}

// A twin id's item, de-duplicated; later entries win.
function dedupeById(items: TodoistTaskData[]): TodoistTaskData[] {
  const byId = new Map<string, TodoistTaskData>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

// How deep an item nests, walking the fetched parent chain. A parent outside
// the fetched set stops the walk, so a child whose parent is elsewhere still
// sorts as if top-level for ordering purposes.
function depthOf(
  item: TodoistTaskData,
  byId: Map<string, TodoistTaskData>,
): number {
  let depth = 0;
  let parentId = item.parentId;
  const seen = new Set<string>();
  while (parentId !== null && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth++;
    parentId = byId.get(parentId)!.parentId;
  }
  return depth;
}

// A to-do's parent task link: the first non-project affiliation link.
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

function stemOf(path: string): string {
  const basename = path.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

function isToDoPath(path: string, projectName: string): boolean {
  return path.startsWith(`Projecten/${projectName}/todos/`);
}

function isMirroredPath(path: string, projectName: string): boolean {
  return (
    path.startsWith(`Projecten/${projectName}/taken/`) ||
    isToDoPath(path, projectName)
  );
}
