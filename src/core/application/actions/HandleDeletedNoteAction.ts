import { CanonicalFieldWrite } from '../../port/data/CanonicalFieldWrite.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

export interface HandleDeletedNoteInput {
  notePath: string;
  projectName: string;
  connections: readonly ConnectionDataTransferObject[];
}

export class HandleDeletedNoteAction {
  constructor(
    private readonly syncState: RegistryPort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
  ) {}

  async execute(input: HandleDeletedNoteInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.notePath);
    if (!record) {
      return;
    }

    const deletedAt = new Date().toISOString();
    let recorded = false;
    for (const connection of input.connections) {
      const found = await this.syncState.findMirrorItemByEntity(
        connection.slug,
        record.id,
      );
      if (found === null) {
        continue;
      }
      try {
        await this.syncState.recordTombstone({
          entityId: record.id,
          notePath: input.notePath,
          deletedAt,
          handle: found.handle,
        });
        recorded = true;
        await this.deleteMirror(input.projectName, connection, found.handle);
      } catch (error) {
        console.error(
          `HandleDeletedNoteAction: mirror delete of ${found.handle} failed; will retry`,
          error,
        );
      }
    }

    if (!recorded) {
      await this.syncState.recordTombstone({
        entityId: record.id,
        notePath: input.notePath,
        deletedAt,
      });
    }
  }

  private async deleteMirror(
    projectName: string,
    connection: HandleDeletedNoteInput['connections'][number],
    handle: string,
  ): Promise<void> {
    const adapter = this.mirrorAdapters.create(
      connection.application,
      connection.target,
      connection.slug,
      projectName,
    );
    if (adapter === null) {
      return;
    }

    await adapter.applyField(
      new CanonicalFieldWrite({
        handle,
        field: 'completion',
        value: 'true',
      }),
    );
    await adapter.deleteTask(handle);
    await this.syncState.removeMirrorItem(projectName, connection.slug, handle);
  }
}
