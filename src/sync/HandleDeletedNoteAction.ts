import { CanonicalFieldWrite } from '../core/data/CanonicalFieldWrite.js';
import type { MirrorAdapterFactoryPort } from '../core/ports/MirrorAdapterFactoryPort.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';

export interface HandleDeletedNoteInput {
  notePath: string;
  projectName: string;
  connectionSlug: string | null;
  application: string;
  target: string;
}

export class HandleDeletedNoteAction {
  constructor(
    private readonly syncState: SyncStatePort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: HandleDeletedNoteInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.notePath);
    if (!record) {
      return;
    }

    if (input.connectionSlug !== null) {
      await this.deleteMirror(input, input.connectionSlug, record.id);
    }
    await this.syncState.removeEntity(record.id);
  }

  private async deleteMirror(
    input: HandleDeletedNoteInput,
    connection: string,
    entityId: string,
  ): Promise<void> {
    const found = await this.syncState.findMirrorItemByEntity(
      connection,
      entityId,
    );
    if (found === null) {
      return;
    }

    const adapter = this.mirrorAdapters.create(
      input.application,
      input.target,
      connection,
      input.projectName,
    );
    if (adapter === null) {
      return;
    }

    await adapter.tasks.deleteTask(found.handle);
    const lane = found.item.base?.status ?? '';
    if (lane !== this.doneOptionName) {
      await adapter.tasks.applyField(
        new CanonicalFieldWrite({
          handle: found.handle,
          field: 'completion',
          value: 'true',
        }),
      );
    }
  }
}
