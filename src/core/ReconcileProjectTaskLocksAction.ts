import type { DeclaredConnection } from './data/DeclaredConnection.js';
import type { MirrorAdapterFactoryPort } from './ports/MirrorAdapterFactoryPort.js';
import type { MirrorHandlePort } from './ports/MirrorHandlePort.js';
import type { OriginPort } from './ports/OriginPort.js';
import type { ProjectSourcePort } from './ports/ProjectSourcePort.js';
import type { TaskLockPort } from './ports/TaskLockPort.js';

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
        connection.envelope.application,
        connection.envelope.target,
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
    connection: DeclaredConnection,
    taskLock: TaskLockPort,
    input: ReconcileProjectTaskLocksInput,
  ): Promise<void> {
    const tracked = await this.handles.list(input.project, connection.slug);
    for (const { handle, notePath } of tracked) {
      if (input.frozen) {
        if (await this.isDone(notePath)) {
          continue;
        }
        await taskLock.lockTask(handle);
      } else {
        await taskLock.unlockTask(handle);
      }
    }
  }

  private async isDone(notePath: string): Promise<boolean> {
    const task = await this.origin.readTask(notePath);
    return task !== null && task.status === this.doneOptionName;
  }
}
