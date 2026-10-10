import type { ConnectionDataTransferObject } from '../data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorHandlePort } from '../../port/MirrorHandlePort.js';
import type { OriginPort } from '../../port/OriginPort.js';
import type { ProjectSourcePort } from '../../port/ProjectSourcePort.js';
import type { TaskLockPort } from '../../port/TaskLockPort.js';

export interface ReconcileProjectTaskLocksInput {
  project: string;
  frozen: boolean;
  wasFrozen: boolean;
}

export class ReconcileProjectTaskLocksAction {
  constructor(
    private readonly projectSource: ProjectSourcePort,
    private readonly origin: OriginPort,
    private readonly handles: MirrorHandlePort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
    private readonly doneOptionName: string,
  ) {}

  async invoke(input: ReconcileProjectTaskLocksInput): Promise<void> {
    if (input.frozen === input.wasFrozen) {
      return;
    }
    const connections = await this.projectSource.readConnections(input.project);
    for (const connection of connections) {
      const adapter = this.mirrorAdapters.create(
        connection.application,
        connection.target,
        connection.slug,
        input.project,
      );
      if (adapter === null || adapter.taskLock === undefined) {
        continue;
      }
      await this.applyToConnection(connection, adapter.taskLock, input);
    }
  }

  private async applyToConnection(
    connection: ConnectionDataTransferObject,
    taskLock: TaskLockPort,
    input: ReconcileProjectTaskLocksInput,
  ): Promise<void> {
    const tracked = await this.handles.list(input.project, connection.slug);
    for (const { handle, notePath } of tracked) {
      await this.applyToTask(taskLock, handle, notePath, input.frozen);
    }
  }

  private async applyToTask(
    taskLock: TaskLockPort,
    handle: string,
    notePath: string,
    frozen: boolean,
  ): Promise<void> {
    try {
      if (frozen) {
        if (await this.isDone(notePath)) {
          return;
        }
        await taskLock.lockTask(handle);
      } else {
        await taskLock.unlockTask(handle);
      }
    } catch (error) {
      console.error(
        `ReconcileProjectTaskLocksAction: task ${handle} failed`,
        error,
      );
    }
  }

  private async isDone(notePath: string): Promise<boolean> {
    const task = await this.origin.readTask(notePath);
    return task !== null && task.status === this.doneOptionName;
  }
}
