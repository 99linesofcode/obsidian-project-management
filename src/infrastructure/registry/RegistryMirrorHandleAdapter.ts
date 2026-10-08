import type { MirrorHandlePort } from '../../core/ports/MirrorHandlePort.js';

export interface MirrorItemLookup {
  findByNotePath(notePath: string): Promise<{ id: string } | null>;
  findMirrorItemByEntity(
    connection: string,
    entityId: string,
  ): Promise<{ handle: string } | null>;
}

export interface MirrorItemRecorder {
  setEntity(record: { id: string; notePath: string }): Promise<void>;
  setMirrorItem(
    project: string,
    connection: string,
    handle: string,
    item: { entityId: string; base: null },
  ): Promise<void>;
}

export class RegistryMirrorHandleAdapter implements MirrorHandlePort {
  constructor(
    private readonly registry: MirrorItemLookup & MirrorItemRecorder,
  ) {}

  async resolve(connection: string, notePath: string): Promise<string | null> {
    const entity = await this.registry.findByNotePath(notePath);
    if (entity === null) {
      return null;
    }
    const item = await this.registry.findMirrorItemByEntity(
      connection,
      entity.id,
    );
    return item?.handle ?? null;
  }

  async record(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void> {
    const entity = await this.registry.findByNotePath(notePath);
    const entityId = entity?.id ?? crypto.randomUUID();
    if (entity === null) {
      await this.registry.setEntity({ id: entityId, notePath });
    }
    await this.registry.setMirrorItem(project, connection, handle, {
      entityId,
      base: null,
    });
  }
}
