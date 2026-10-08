import type { MirrorHandlePort } from '../../core/ports/MirrorHandlePort.js';

export interface MirrorItemLookup {
  findByNotePath(notePath: string): Promise<{ id: string } | null>;
  findMirrorItemByEntity(
    connection: string,
    entityId: string,
  ): Promise<{ handle: string } | null>;
}

export class RegistryMirrorHandleAdapter implements MirrorHandlePort {
  constructor(private readonly registry: MirrorItemLookup) {}

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
}
