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
  connectionSlug: string;
  githubConnectionSlug: string | null;
  syncedAt: string;
  snapshot: TodoistTaskSnapshotData;
}

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

    const items = dedupeById([
      ...input.snapshot.completed,
      ...input.snapshot.active,
    ]);
    if (items.length === 0) {
      return;
    }

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
        notePathById.set(item.id, path);
        continue;
      }

      const parentPath = notePathById.get(parentId);
      if (parentPath === undefined) {
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
    const lane = hasLanes && item.parentId === null ? statusName : null;
    await this.stampCreation(
      path,
      item,
      lane,
      input.syncedAt,
      input.projectName,
      input.connectionSlug,
    );
    return path;
  }

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
    await this.stampCreation(
      path,
      item,
      null,
      input.syncedAt,
      input.projectName,
      input.connectionSlug,
    );
    return path;
  }

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
        completedAt: item.isCompleted ? item.completedAt || syncedAt : null,
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

function dedupeById(items: TodoistTaskData[]): TodoistTaskData[] {
  const byId = new Map<string, TodoistTaskData>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

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
