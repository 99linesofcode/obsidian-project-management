import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../port/MirrorPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';
import { effectiveConnectionTarget } from '../services/connectionTarget.js';

export interface ReconcileProjectTaskLocksInput {
  project: string;
  frozen: boolean;
  wasFrozen: boolean;
}

export class ReconcileProjectTaskLocksAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
    private readonly doneOptionName: string,
  ) {}

  async invoke(input: ReconcileProjectTaskLocksInput): Promise<void> {
    if (input.frozen === input.wasFrozen) {
      return;
    }
    const connections = await this.vault.readConnections(input.project);
    for (const connection of connections) {
      const target = await effectiveConnectionTarget(
        this.registry,
        input.project,
        connection,
      );
      if (target === null) {
        continue;
      }
      const adapter = this.mirrorAdapters.create(
        connection.application,
        target,
        connection.slug,
        input.project,
      );
      if (
        adapter === null ||
        adapter.lockTask === undefined ||
        adapter.unlockTask === undefined
      ) {
        continue;
      }
      await this.applyToConnection(connection, adapter, input);
    }
  }

  private async applyToConnection(
    connection: ConnectionDataTransferObject,
    adapter: MirrorPort,
    input: ReconcileProjectTaskLocksInput,
  ): Promise<void> {
    const tracked = await this.registry.listMirrorHandles(
      input.project,
      connection.slug,
    );
    for (const { handle, notePath } of tracked) {
      await this.applyToTask(adapter, handle, notePath, input.frozen);
    }
  }

  private async applyToTask(
    adapter: MirrorPort,
    handle: string,
    notePath: string,
    frozen: boolean,
  ): Promise<void> {
    if (adapter.lockTask === undefined || adapter.unlockTask === undefined) {
      return;
    }
    try {
      if (frozen) {
        if (await this.isDone(notePath)) {
          return;
        }
        await adapter.lockTask(handle);
      } else {
        await adapter.unlockTask(handle);
      }
    } catch (error) {
      console.error(
        `ReconcileProjectTaskLocksAction: task ${handle} failed`,
        error,
      );
    }
  }

  private async isDone(notePath: string): Promise<boolean> {
    const task = await this.vault.readTask(notePath);
    return task !== null && task.status === this.doneOptionName;
  }
}
