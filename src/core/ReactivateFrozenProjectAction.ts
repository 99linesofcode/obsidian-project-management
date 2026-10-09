import type { DeclaredConnection } from './data/DeclaredConnection.js';
import type { BaselineStorePort } from './ports/BaselineStorePort.js';
import type { MirrorAdapterFactoryPort } from './ports/MirrorAdapterFactoryPort.js';
import type { ProjectActivityPort } from './ports/ProjectActivityPort.js';
import type { ProjectLifecycleOriginPort } from './ports/ProjectLifecycleOriginPort.js';
import type { ProjectSourcePort } from './ports/ProjectSourcePort.js';
import type { ProjectWatchPort } from './ports/ProjectWatchPort.js';

const ORIGIN_SIDE = 'origin';
const LIFECYCLE_FIELD = 'lifecycle';

export class ReactivateFrozenProjectAction {
  constructor(
    private readonly projectSource: ProjectSourcePort,
    private readonly origin: ProjectLifecycleOriginPort,
    private readonly baselines: BaselineStorePort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
    private readonly watches: ProjectWatchPort,
  ) {}

  async invoke(project: string): Promise<boolean> {
    if (!(await this.wasFrozen(project))) {
      return false;
    }
    const connections = await this.projectSource.readConnections(project);
    let reactivated = false;
    for (const connection of connections) {
      const adapter = this.mirrorAdapters.create(
        connection.envelope.application,
        connection.envelope.target,
        connection.slug,
        project,
      );
      if (adapter === null || adapter.activity === undefined) {
        continue;
      }
      if (
        await this.reactivateOnNewerWork(project, connection, adapter.activity)
      ) {
        reactivated = true;
      }
    }
    return reactivated;
  }

  private async wasFrozen(project: string): Promise<boolean> {
    const baseline = await this.baselines.read(
      project,
      LIFECYCLE_FIELD,
      ORIGIN_SIDE,
    );
    return baseline?.value === 'true';
  }

  private async reactivateOnNewerWork(
    project: string,
    connection: DeclaredConnection,
    activity: ProjectActivityPort,
  ): Promise<boolean> {
    const watch = await this.watches.read(project, connection.slug);
    const latest = await activity.latestActivity(
      connection.envelope.target,
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
      await this.origin.applyProjectArchived(project, false);
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
