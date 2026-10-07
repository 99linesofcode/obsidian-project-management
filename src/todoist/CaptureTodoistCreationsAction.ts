import { laneForSection } from '../tasks/laneForSection.js';
import { TaskData } from '../shared/TaskData.js';
import type { TodoistTaskSnapshotData } from './TodoistTaskSnapshotData.js';
import { CapturedTaskNoteMapper } from '../vault/CapturedTaskNoteMapper.js';
import { parseChecklist, renderChecklist } from '../vault/Checklist.js';
import { freePath } from '../vault/freePath.js';
import { stemOf } from '../shared/stemOf.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { taskLinkFromAffiliation } from '../shared/taskLinkFromAffiliation.js';
import { ToDoNoteMapper } from '../vault/ToDoNoteMapper.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import { withBody } from '../vault/withBody.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import { SLICE_LABEL } from '../shared/labels.js';
import { ensureEntity } from '../registry/ensureEntity.js';
import { parentUuid } from '../registry/parentUuid.js';
import { todoistEntries } from '../registry/todoistEntries.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import { readTemplate } from '../vault/readTemplate.js';
import type { VaultPort } from '../shared/VaultPort.js';

export interface CaptureTodoistCreationsInput {
  projectName: string;
  // The connection whose mirror this pass advances.
  connectionSlug: string;
  // The project's code-host connection slug, when it has one, so the lane
  // vocabulary resolves from that connection's identity.
  githubConnectionSlug: string | null;
  syncedAt: string;
  // The pass's shared Todoist snapshot. The half fetched the active and
  // completed sets once; this absorber never lists the project itself.
  snapshot: TodoistTaskSnapshotData;
}

// UC: capture Todoist-created items into the vault (dt-06). A fetched item with
// no anchored record is a creation; its kind follows its position in Todoist:
//
//   - top-level          -> captured task note affiliated to the project
//   - under a slice twin -> captured task note affiliated to that slice
//   - under a task twin  -> to-do note linked from that task's checklist
//   - under a to-do twin -> nested to-do (Todoist's fourth indent level)
//
// A captured task note is a draft: no GitHub issue, no `url` frontmatter, no
// github mirror — the `todoist` mirror and the registry record are its
// identity. Todoist-created items carry no type label until the user promotes
// them through the existing UC21 flow, so no type is invented here. The status
// follows the item's section (the lane whose section it sits in); a section-less
// item lands in the default lane, a completed one in the done lane. The note's
// vault-owned id, its anchor and the registry record are stamped immediately
// (the echo guard): the next poll must read the item as anchored, not as a
// fresh creation.
//
// Nothing is ever written back to Todoist from here: no issue, project or
// section is created from the Todoist side.
export class CaptureTodoistCreationsAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly todoTemplatePath: string,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: CaptureTodoistCreationsInput): Promise<void> {
    const portState = await this.syncState.getPortState(
      input.projectName,
      input.connectionSlug,
    );
    const sections = portState?.lanes ?? {};

    // The pass's snapshot was fetched upstream, active last so a reopened item
    // reads as active.
    const items = dedupeById([
      ...input.snapshot.completed,
      ...input.snapshot.active,
    ]);
    if (items.length === 0) {
      return;
    }

    // The project's anchored todoist items: their handles are the twins already
    // in the registry, so a fetched item matching one is not a creation. The
    // item's entityId resolves the note path through the hub entity.
    const entries = await todoistEntries(
      this.syncState,
      input.connectionSlug,
      input.projectName,
    );
    const anchored = new Set(entries.map((entry) => entry.handle));
    const notePathById = new Map(
      entries.map((entry) => [entry.handle, entry.record.notePath] as const),
    );

    const identity =
      input.githubConnectionSlug === null
        ? null
        : await this.syncState.getIdentity(
            input.projectName,
            input.githubConnectionSlug,
          );
    const hasLanes = (identity?.statusOptions.length ?? 0) > 0;
    const defaultLane = identity?.statusOptions[0]?.name ?? null;

    const byId = new Map(items.map((item) => [item.id, item] as const));
    // Parents before children: a captured parent must carry its record and
    // bookkeeping before its child can affiliate to it.
    const ordered = [...items].sort(
      (a, b) => depthOf(a, byId) - depthOf(b, byId),
    );
    const template = await readTemplate(this.vault, this.todoTemplatePath);

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
      },
      { syncedAt: input.syncedAt, statusName },
    );
    const path = await freePath(this.vault, rendered.path);
    await this.vault.createNote(path, rendered.content);
    // The lane is controlled only for a top-level task (a subtask inherits its
    // parent's section, dt-02).
    const lane = hasLanes && item.parentId === null ? statusName : null;
    await this.stampCreation(path, item, lane, input.syncedAt, input.projectName, input.connectionSlug);
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
    const path = await freePath(this.vault, rendered.path);
    await this.vault.createNote(path, rendered.content);
    await this.addChecklistItem(
      `Projecten/${input.projectName}/taken/${taskLink}.md`,
      item,
      path,
    );
    // A to-do is a subtask: its lane is inherited, so it is never controlled.
    await this.stampCreation(path, item, null, input.syncedAt, input.projectName, input.connectionSlug);
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

  // Mints the note's vault-owned uuid when it has none, then writes the
  // registry record with the todoist mirror. The base is a diff view whose
  // parent is the parent entity's uuid, so the deletion sweep can walk the
  // cascade.
  private async stampCreation(
    notePath: string,
    item: TodoistTaskData,
    lane: string | null,
    syncedAt: string,
    projectName: string,
    connectionSlug: string,
  ): Promise<void> {
    const id = await ensureEntity(this.syncState, notePath);
    if (id === '') {
      return;
    }
    const parent = await parentUuid(
      this.syncState,
      connectionSlug,
      item.parentId,
    );
    const base = toDiffViewWithBody(
      new TaskData({
        id: id,
        notePath: notePath,
        mirrors: {},
        title: item.content,
        body: '',
        status: lane ?? '',
        completedAt: item.isCompleted ? (item.completedAt || syncedAt) : null,
        type: '',
        parent: parent,
        createdAt: item.addedAt || null,
        updatedAt: item.updatedAt || null,
      }),
    );
    await this.syncState.setEntity({ id, notePath });
    await this.syncState.setMirrorItem(projectName, connectionSlug, item.id, {
      entityId: id,
      base,
    });
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

function isToDoPath(path: string, projectName: string): boolean {
  return path.startsWith(`Projecten/${projectName}/todos/`);
}
