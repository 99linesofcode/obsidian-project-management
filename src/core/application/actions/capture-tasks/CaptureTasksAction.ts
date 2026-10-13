import type { CanonicalTask } from '../../../port/data/CanonicalTask.js';
import type { ConnectionDataTransferObject } from '../../../port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../../port/MirrorPort.js';
import type { RegistryPort } from '../../../port/RegistryPort.js';
import type { VaultPort } from '../../../port/VaultPort.js';
import { freePath } from '../../../domain/paths.js';
import { typeFromLabels } from '../../../domain/note.js';
import { effectiveConnectionTarget } from '../../services/connectionTarget.js';
import type { CreateTaskNoteAction } from '../create-task-note/CreateTaskNoteAction.js';
import { CapturedTaskNoteMapper } from './CapturedTaskNoteMapper.js';

export interface CaptureTasksResult {
  captured: string[];
  errors: unknown[];
}

interface AdoptTaskInput {
  task: CanonicalTask;
  application: string;
  slug: string;
  projectName: string;
  syncedAt: string;
}

// The capture-adoption orchestration: for a code-host task it starts
// `CreateTaskNoteAction`; for a task-manager task it renders the draft note
// (the pure mapper) and writes it through `VaultPort` + `RegistryPort`.
// The driven adapters stay raw I/O — no adapter starts a use case.
export class CaptureTasksAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly factory: MirrorAdapterFactoryPort,
    private readonly registry: RegistryPort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly isCodeHost: (application: string) => boolean,
  ) {}

  async invoke(project: string, syncedAt: string): Promise<CaptureTasksResult> {
    const connections = await this.vault.readConnections(project);
    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const connection of connections) {
      const target = await effectiveConnectionTarget(
        this.registry,
        project,
        connection,
      );
      if (target === null) {
        continue;
      }
      const adapter = this.factory.create(
        connection.application,
        target,
        connection.slug,
        project,
      );
      if (adapter === null || adapter.capture === undefined) {
        continue;
      }
      try {
        const result = await this.captureConnection(
          project,
          connection,
          target,
          adapter,
          syncedAt,
        );
        captured.push(...result.captured);
        errors.push(...result.errors);
      } catch (error) {
        errors.push(error);
      }
    }
    return { captured, errors };
  }

  private async captureConnection(
    project: string,
    connection: ConnectionDataTransferObject,
    target: string,
    adapter: MirrorPort,
    syncedAt: string,
  ): Promise<CaptureTasksResult> {
    if (adapter.capture === undefined) {
      return { captured: [], errors: [] };
    }
    const tasks = await adapter.capture(target);
    const adopted = new Set(
      (await this.registry.listMirrorItems(project, connection.slug)).map(
        ({ handle }) => handle,
      ),
    );

    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const task of tasks) {
      if (adopted.has(task.handle)) {
        continue;
      }
      if ((await this.registry.findTombstone(task.handle)) !== null) {
        continue;
      }
      try {
        await this.adopt({
          task,
          application: connection.application,
          slug: connection.slug,
          projectName: project,
          syncedAt,
        });
      } catch (error) {
        errors.push(error);
        break;
      }
      captured.push(task.handle);
      adopted.add(task.handle);
    }
    return { captured, errors };
  }

  private async adopt(input: AdoptTaskInput): Promise<void> {
    if (input.task.handle === '') {
      throw new Error('cannot adopt a task with an empty handle');
    }
    if (this.isCodeHost(input.application)) {
      await this.adoptCodeHostTask(input);
      return;
    }
    await this.adoptTaskManagerTask(input);
  }

  private async adoptCodeHostTask(input: AdoptTaskInput): Promise<void> {
    await this.createTaskNote.execute({
      url: input.task.handle,
      title: input.task.title,
      body: input.task.body,
      type: typeFromLabels([...input.task.labels]),
      projectName: input.projectName,
      connectionSlug: input.slug,
      syncedAt: input.syncedAt,
      statusName: input.task.status,
    });
  }

  private async adoptTaskManagerTask(input: AdoptTaskInput): Promise<void> {
    const rendered = CapturedTaskNoteMapper.map(
      {
        title: input.task.title,
        projectName: input.projectName,
        sliceLink: null,
        kind: capturedKind(input.task),
      },
      { syncedAt: input.syncedAt, statusName: input.task.status },
    );
    const path = await freePath(this.vault, rendered.path);
    await this.vault.createNote(path, rendered.content);
    const id = crypto.randomUUID();
    await this.registry.setEntity({ id, notePath: path });
    await this.registry.setMirrorItem(
      input.projectName,
      input.slug,
      input.task.handle,
      { entityId: id },
    );
  }
}

// The kind a task-manager capture carries: its explicit type label when it has
// one, otherwise the kind its position implies — a root item is a slice, a
// subtask is a task.
function capturedKind(task: CanonicalTask): string {
  const explicit = typeFromLabels(task.labels);
  if (explicit !== '') {
    return explicit;
  }
  return task.parent !== null ? 'task' : 'slice';
}
