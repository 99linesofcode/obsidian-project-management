import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../port/MirrorPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';
import type { ProjectWatchPort } from '../../port/ProjectWatchPort.js';

const ORIGIN_SIDE = 'origin';
const LIFECYCLE_FIELD = 'lifecycle';

export class ReactivateFrozenProjectAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
    private readonly watches: ProjectWatchPort,
  ) {}

  async invoke(project: string): Promise<boolean> {
    if (!(await this.wasFrozen(project))) {
      return false;
    }
    const connections = await this.vault.readConnections(project);
    let reactivated = false;
    for (const connection of connections) {
      const adapter = this.mirrorAdapters.create(
        connection.application,
        connection.target,
        connection.slug,
        project,
      );
      if (adapter === null) {
        continue;
      }
      if (await this.reactivateOnNewerWork(project, connection, adapter)) {
        reactivated = true;
      }
    }
    return reactivated;
  }

  private async wasFrozen(project: string): Promise<boolean> {
    const baseline = await this.registry.readBaseline(
      project,
      LIFECYCLE_FIELD,
      ORIGIN_SIDE,
    );
    return baseline?.value === 'true';
  }

  private async reactivateOnNewerWork(
    project: string,
    connection: ConnectionDataTransferObject,
    adapter: MirrorPort,
  ): Promise<boolean> {
    if (adapter.latestActivity === undefined) {
      return false;
    }
    const watch = await this.watches.read(project, connection.slug);
    const latest = await adapter.latestActivity(
      connection.target,
      watch.etag ?? undefined,
    );
    if (!latest.changed) {
      return false;
    }
    if (watch.cursor === null) {
      await this.watches.write(project, connection.slug, {
        etag: latest.etag,
        cursor: latest.newestCreatedAt,
      });
      return false;
    }
    if (
      latest.newestCreatedAt !== null &&
      latest.newestCreatedAt > watch.cursor
    ) {
      await this.vault.applyProjectArchived(project, false);
      await this.watches.write(project, connection.slug, {
        etag: null,
        cursor: null,
      });
      return true;
    }
    await this.watches.write(project, connection.slug, {
      etag: latest.etag,
      cursor: watch.cursor,
    });
    return false;
  }
}
