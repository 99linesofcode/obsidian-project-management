import type { VaultPort } from '../../port/VaultPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { EntityRecord } from '../../port/data/EntityRecord.js';
import type { HandleDeletedNoteAction } from './HandleDeletedNoteAction.js';

export interface SweepDeletedNotesInput {
  projectId: string;
  projectName: string;
  connections: readonly ConnectionDataTransferObject[];
}

export class SweepDeletedNotesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: RegistryPort,
    private readonly handleDeletedNote: HandleDeletedNoteAction,
  ) {}

  async execute(input: SweepDeletedNotesInput): Promise<void> {
    const prefix = `Projecten/${input.projectName}/`;
    let noteIds: readonly { id: string; path: string }[] | null = null;

    for (const record of await this.syncState.listEntities(input.projectId)) {
      if (!record.notePath.startsWith(prefix)) {
        continue;
      }
      if ((await this.vault.getNoteByPath(record.notePath)) !== null) {
        await this.clearTombstone(record.notePath);
        continue;
      }
      noteIds ??= await this.vault.readNoteIds();
      if (noteIds.some((note) => note.id === record.id)) {
        await this.clearTombstone(record.notePath);
        continue;
      }
      if (await this.isSettled(record, input.connections)) {
        await this.syncState.removeEntity(record.id);
        continue;
      }
      if (!(await this.recordTombstones(record, input.connections))) {
        continue;
      }
      await this.handToHandler(record.notePath, input);
    }
  }

  private async clearTombstone(notePath: string): Promise<void> {
    if ((await this.syncState.findTombstoneByNotePath(notePath)) === null) {
      return;
    }
    await this.syncState.removeTombstone(notePath);
  }

  private async isSettled(
    record: EntityRecord,
    connections: SweepDeletedNotesInput['connections'],
  ): Promise<boolean> {
    const tombstone = await this.syncState.findTombstoneByNotePath(
      record.notePath,
    );
    if (tombstone === null) {
      return false;
    }
    for (const connection of connections) {
      const item = await this.syncState.findMirrorItemByEntity(
        connection.slug,
        record.id,
      );
      if (item !== null) {
        return false;
      }
    }
    return true;
  }

  private async recordTombstones(
    record: EntityRecord,
    connections: SweepDeletedNotesInput['connections'],
  ): Promise<boolean> {
    const handles = await this.mirrorHandles(record, connections);
    if (handles.length === 0) {
      return this.recordTombstone(record, null);
    }

    let recorded = true;
    for (const handle of handles) {
      recorded = (await this.recordTombstone(record, handle)) && recorded;
    }
    return recorded;
  }

  private async recordTombstone(
    record: EntityRecord,
    handle: string | null,
  ): Promise<boolean> {
    try {
      await this.syncState.recordTombstone({
        entityId: record.id,
        notePath: record.notePath,
        deletedAt: new Date().toISOString(),
        ...(handle === null ? {} : { handle }),
      });
      return true;
    } catch (error) {
      console.error(
        `SweepDeletedNotesAction: tombstone for ${record.notePath} failed`,
        error,
      );
      return false;
    }
  }

  private async mirrorHandles(
    record: EntityRecord,
    connections: SweepDeletedNotesInput['connections'],
  ): Promise<string[]> {
    const handles: string[] = [];
    for (const connection of connections) {
      const item = await this.syncState.findMirrorItemByEntity(
        connection.slug,
        record.id,
      );
      if (item !== null) {
        handles.push(item.handle);
      }
    }
    return handles;
  }

  private async handToHandler(
    notePath: string,
    input: SweepDeletedNotesInput,
  ): Promise<void> {
    try {
      await this.handleDeletedNote.execute({
        notePath,
        projectId: input.projectId,
        projectName: input.projectName,
        connections: input.connections,
      });
    } catch (error) {
      console.error(
        `SweepDeletedNotesAction: delete ${notePath} failed`,
        error,
      );
    }
  }
}
