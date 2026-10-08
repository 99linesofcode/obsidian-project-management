import { TaskData } from '../shared/TaskData.js';
import { hasCompletionStamp } from '../shared/hasCompletionStamp.js';
import type { TodoistTaskSnapshotData } from './TodoistTaskSnapshotData.js';
import { ToDoNoteParser, withToDoStatus } from '../vault/ToDoNoteParser.js';
import { VaultTaskMapper } from '../vault/VaultTaskMapper.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import { todoistEntries } from '../registry/todoistEntries.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { ApplyTaskToVaultAction } from '../tasks/ApplyTaskToVaultAction.js';

export interface ApplyTodoistCompletionInput {
  projectName: string;
  connectionSlug: string;
  githubConnectionSlug: string | null;
  syncedAt: string;
  snapshot: TodoistTaskSnapshotData;
}

export class ApplyTodoistCompletionAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly applyToVault: ApplyTaskToVaultAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ApplyTodoistCompletionInput): Promise<void> {
    const portState = await this.syncState.getPortState(
      input.projectName,
      input.connectionSlug,
    );

    const { completed, active } = input.snapshot;
    const activeById = new Map(active.map((task) => [task.id, task]));

    const entries = await todoistEntries(
      this.syncState,
      input.connectionSlug,
      input.projectName,
    );
    const byHandle = new Map<
      string,
      { record: EntityRecord; base: TaskData | null }
    >();
    for (const entry of entries) {
      byHandle.set(entry.handle, { record: entry.record, base: entry.base });
    }

    for (const task of completed) {
      const entry = byHandle.get(task.id);
      if (!entry) {
        continue;
      }
      if (hasCompletionStamp(entry.base)) {
        continue;
      }
      await this.applyCompletion(
        entry.record,
        task.id,
        entry.base,
        task,
        input,
      );
    }

    for (const [handle, entry] of byHandle) {
      const twin = activeById.get(handle);
      if (!twin) {
        continue;
      }
      if (!hasCompletionStamp(entry.base)) {
        continue;
      }
      await this.applyReopen(entry.record, handle, entry.base, twin, input);
    }

    await this.syncState.setPortState(input.projectName, input.connectionSlug, {
      provider: 'todoist',
      project: portState?.project ?? '',
      lastPoll: input.syncedAt,
      lanes: portState?.lanes ?? {},
    });
  }

  private async applyCompletion(
    record: EntityRecord,
    handle: string,
    base: TaskData | null,
    task: TodoistTaskData,
    input: ApplyTodoistCompletionInput,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(record.notePath);
    if (!note) {
      return;
    }
    const stamp = task.completedAt || input.syncedAt;

    if (isToDoPath(record.notePath, input.projectName)) {
      const parsed = ToDoNoteParser.parse(note.content);
      if (!parsed) {
        return;
      }
      if (parsed.status !== 'completed') {
        await this.vault.writeNote(
          record.notePath,
          withToDoStatus(note.content, 'completed', input.syncedAt),
        );
      }
      await this.stampBase(
        record,
        handle,
        base,
        input.projectName,
        input.connectionSlug,
        {
          title: task.content,
          status: 'completed',
          completedAt: stamp,
        },
      );
      return;
    }

    const current = VaultTaskMapper.parseTask(note.content, record.notePath, {
      projectName: input.projectName,
      doneLane: this.doneOptionName,
    });
    if (!current) {
      return;
    }
    if (
      current.completedAt === null &&
      current.status !== this.doneOptionName
    ) {
      await this.applyToVault.execute({
        task: withCompletion(current, this.doneOptionName, stamp),
        current,
        projectName: input.projectName,
        connectionSlug: input.connectionSlug,
        syncedAt: input.syncedAt,
        origin: 'push',
        record,
      });
    }
    await this.stampBase(
      record,
      handle,
      base,
      input.projectName,
      input.connectionSlug,
      {
        title: current.title,
        status: this.doneOptionName,
        completedAt: stamp,
      },
    );
  }

  private async applyReopen(
    record: EntityRecord,
    handle: string,
    base: TaskData | null,
    twin: TodoistTaskData,
    input: ApplyTodoistCompletionInput,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(record.notePath);
    if (!note) {
      return;
    }

    if (isToDoPath(record.notePath, input.projectName)) {
      const parsed = ToDoNoteParser.parse(note.content);
      if (!parsed) {
        return;
      }
      if (parsed.status === 'completed') {
        await this.vault.writeNote(
          record.notePath,
          withToDoStatus(note.content, 'open', null),
        );
      }
      await this.stampBase(
        record,
        handle,
        base,
        input.projectName,
        input.connectionSlug,
        {
          title: twin.content,
          status: 'open',
          completedAt: null,
        },
      );
      return;
    }

    const current = VaultTaskMapper.parseTask(note.content, record.notePath, {
      projectName: input.projectName,
      doneLane: this.doneOptionName,
    });
    if (!current) {
      return;
    }
    const identity =
      input.githubConnectionSlug === null
        ? null
        : await this.syncState.getIdentity(
            input.projectName,
            input.githubConnectionSlug,
          );
    const defaultLane = identity?.statusOptions[0]?.name ?? '';
    if (defaultLane === '') {
      return;
    }
    const done =
      current.completedAt !== null || current.status === this.doneOptionName;
    if (done) {
      await this.applyToVault.execute({
        task: withReopen(current, defaultLane),
        current,
        projectName: input.projectName,
        connectionSlug: input.connectionSlug,
        syncedAt: input.syncedAt,
        origin: 'push',
        record,
      });
    }
    await this.stampBase(
      record,
      handle,
      base,
      input.projectName,
      input.connectionSlug,
      {
        title: current.title,
        status: defaultLane,
        completedAt: null,
      },
    );
  }

  private async stampBase(
    record: EntityRecord,
    handle: string,
    base: TaskData | null,
    projectName: string,
    connectionSlug: string,
    shape: { title: string; status: string; completedAt: string | null },
  ): Promise<void> {
    const id = record.id;
    const view = toDiffViewWithBody(
      new TaskData({
        id: id,
        notePath: record.notePath,
        mirrors: {},
        title: shape.title,
        body: '',
        status: shape.status,
        completedAt: shape.completedAt,
        type: '',
        parent: base?.parent ?? null,
        createdAt: base?.createdAt ?? null,
        updatedAt: base?.updatedAt ?? null,
      }),
    );
    await this.syncState.setMirrorItem(projectName, connectionSlug, handle, {
      entityId: id,
      base: view,
    });
  }
}

function withCompletion(
  current: TaskData,
  doneLane: string,
  completedAt: string,
): TaskData {
  return new TaskData({
    id: current.id,
    notePath: current.notePath,
    mirrors: current.mirrors,
    title: current.title,
    body: current.body,
    status: doneLane,
    completedAt: completedAt,
    type: current.type,
    parent: current.parent,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
}

function withReopen(current: TaskData, defaultLane: string): TaskData {
  return new TaskData({
    id: current.id,
    notePath: current.notePath,
    mirrors: current.mirrors,
    title: current.title,
    body: current.body,
    status: defaultLane,
    completedAt: null,
    type: current.type,
    parent: current.parent,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
}

function isToDoPath(notePath: string, projectName: string): boolean {
  return notePath.startsWith(`Projecten/${projectName}/todos/`);
}
