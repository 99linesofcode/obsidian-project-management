import type { MirrorHandlePort } from '../../core/port/MirrorHandlePort.js';
import type { TrackedEntityPort } from '../../core/port/TrackedEntityPort.js';

export class RegistryMirrorHandleAdapter implements MirrorHandlePort {
  constructor(private readonly registry: TrackedEntityPort) {}

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

  async list(
    project: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]> {
    const items = await this.registry.listMirrorItems(project, connection);
    const resolved: Array<{ handle: string; notePath: string }> = [];
    for (const { handle, item } of items) {
      const entity = await this.registry.getEntity(item.entityId);
      if (entity !== null) {
        resolved.push({ handle, notePath: entity.notePath });
      }
    }
    return resolved;
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
    const existing = await this.registry.findMirrorItemByEntity(
      connection,
      entityId,
    );
    if (existing !== null && existing.handle !== handle) {
      await this.registry.removeMirrorItem(
        project,
        connection,
        existing.handle,
      );
    }
    await this.registry.setMirrorItem(project, connection, handle, {
      entityId,
      base: null,
    });
  }
}
