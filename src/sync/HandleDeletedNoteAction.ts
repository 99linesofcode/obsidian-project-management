import { CanonicalFieldWrite } from '../core/data/CanonicalFieldWrite.js';
import type { MirrorAdapterFactoryPort } from '../core/ports/MirrorAdapterFactoryPort.js';
import type { TrackedEntityPort } from '../core/ports/TrackedEntityPort.js';

export interface HandleDeletedNoteInput {
  notePath: string;
  projectName: string;
  connections: ReadonlyArray<{
    slug: string;
    application: string;
    target: string;
  }>;
}

export class HandleDeletedNoteAction {
  constructor(
    private readonly syncState: TrackedEntityPort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: HandleDeletedNoteInput): Promise<void> {
    const record = await this.syncState.findByNotePath(input.notePath);
    if (!record) {
      return;
    }

    for (const connection of input.connections) {
      await this.deleteMirror(record.id, input.projectName, connection);
    }
    await this.syncState.removeEntity(record.id);
  }

  private async deleteMirror(
    entityId: string,
    projectName: string,
    connection: HandleDeletedNoteInput['connections'][number],
  ): Promise<void> {
    const found = await this.syncState.findMirrorItemByEntity(
      connection.slug,
      entityId,
    );
    if (found === null) {
      return;
    }

    const adapter = this.mirrorAdapters.create(
      connection.application,
      connection.target,
      connection.slug,
      projectName,
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
