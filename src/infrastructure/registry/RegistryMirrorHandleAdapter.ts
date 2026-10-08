import type { MirrorHandlePort } from '../../core/ports/MirrorHandlePort.js';

export interface MirrorItemLookup {
  findMirrorItemByEntity(
    connection: string,
    entityId: string,
  ): Promise<{ handle: string } | null>;
}

export class RegistryMirrorHandleAdapter implements MirrorHandlePort {
  constructor(private readonly registry: MirrorItemLookup) {}

  async resolve(connection: string, entityId: string): Promise<string | null> {
    const item = await this.registry.findMirrorItemByEntity(
      connection,
      entityId,
    );
    return item?.handle ?? null;
  }
}
