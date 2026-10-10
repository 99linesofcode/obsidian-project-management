import { Baseline } from '../data/Baseline.js';
import type { DeclaredConnection } from '../data/DeclaredConnection.js';
import { MirrorSide } from '../data/MirrorSide.js';
import { ProjectLifecyclePass } from '../data/ProjectLifecyclePass.js';
import type { ProjectLifecycleRecord } from '../data/ProjectLifecycleRecord.js';
import type { RegisteredAdapter } from '../data/RegisteredAdapter.js';
import { mirrorSideKey } from '../mirrorSideKey.js';
import { originSideObservation } from '../originSideObservation.js';
import { ProjectLifecycleSyncAction } from './ProjectLifecycleSyncAction.js';
import type { BaselineStorePort } from '../ports/BaselineStorePort.js';
import type { MirrorAdapterFactoryPort } from '../ports/MirrorAdapterFactoryPort.js';
import type { MirrorProjectPort } from '../ports/MirrorProjectPort.js';
import type { ProjectLifecycleOriginPort } from '../ports/ProjectLifecycleOriginPort.js';
import type { ProjectSourcePort } from '../ports/ProjectSourcePort.js';

const ORIGIN_SIDE = 'origin';
const LIFECYCLE_FIELD = 'lifecycle';

export class AssembleProjectLifecyclePassAction {
  constructor(
    private readonly projectSource: ProjectSourcePort,
    private readonly origin: ProjectLifecycleOriginPort,
    private readonly baselines: BaselineStorePort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
    private readonly mirrorProjects: MirrorProjectPort,
  ) {}

  async invoke(project: string): Promise<ProjectLifecycleRecord> {
    const connections = await this.projectSource.readConnections(project);
    const mirrors = await this.scopeMirrors(connections, project);
    const origin = originSideObservation(
      ORIGIN_SIDE,
      await this.baselines.read(project, LIFECYCLE_FIELD, ORIGIN_SIDE),
      await this.origin.observeProject(project),
    );
    const baselines = await this.readMirrorBaselines(project, mirrors);
    const pass = new ProjectLifecyclePass({
      project,
      origin,
      mirrors,
      baselines,
    });

    const record = await new ProjectLifecycleSyncAction(this.origin).invoke(
      pass,
    );
    await this.persistAdvanced(project, record);
    return record;
  }

  private async scopeMirrors(
    connections: readonly DeclaredConnection[],
    project: string,
  ): Promise<MirrorSide[]> {
    const mirrors: MirrorSide[] = [];
    for (const connection of connections) {
      const adapter = this.mirrorAdapters.create(
        connection.envelope.application,
        connection.envelope.target,
        connection.slug,
        project,
      );
      if (adapter !== null) {
        try {
          mirrors.push(
            new MirrorSide({
              side: mirrorSideKey(connection.slug),
              handle: await this.resolveProject(connection, adapter, project),
              adapter,
            }),
          );
        } catch (error) {
          console.error(
            `AssembleProjectLifecyclePassAction: connection ${connection.slug} failed`,
            error,
          );
        }
      }
    }
    return mirrors;
  }

  private async resolveProject(
    connection: DeclaredConnection,
    adapter: RegisteredAdapter,
    project: string,
  ): Promise<string> {
    const recorded = await this.mirrorProjects.resolve(
      project,
      connection.slug,
    );
    if (recorded !== null) {
      await this.renameIfDrifted(adapter, recorded, project);
      return recorded;
    }

    const existing = await adapter.project.readProject(
      connection.envelope.target,
    );
    if (existing !== null) {
      await this.renameIfDrifted(adapter, connection.envelope.target, project);
      await this.record(connection, project, connection.envelope.target);
      return connection.envelope.target;
    }

    const created = await adapter.project.createProject(
      connection.envelope.target,
      project,
    );
    await this.record(connection, project, created.handle);
    return created.handle;
  }

  private async renameIfDrifted(
    adapter: RegisteredAdapter,
    handle: string,
    project: string,
  ): Promise<void> {
    const mirror = await adapter.project.readProject(handle);
    if (mirror !== null && mirror.name !== project) {
      await adapter.project.renameProject(handle, project);
    }
  }

  private async record(
    connection: DeclaredConnection,
    project: string,
    handle: string,
  ): Promise<void> {
    await this.mirrorProjects.record(
      project,
      connection.slug,
      connection.envelope.application,
      handle,
    );
  }

  private async readMirrorBaselines(
    project: string,
    mirrors: readonly MirrorSide[],
  ): Promise<Map<string, Baseline>> {
    const baselines = new Map<string, Baseline>();
    for (const mirror of mirrors) {
      const baseline = await this.baselines.read(
        project,
        LIFECYCLE_FIELD,
        mirror.side,
      );
      if (baseline !== null) {
        baselines.set(mirror.side, baseline);
      }
    }
    return baselines;
  }

  private async persistAdvanced(
    project: string,
    record: ProjectLifecycleRecord,
  ): Promise<void> {
    for (const side of record.advanced) {
      await this.baselines.write(
        project,
        LIFECYCLE_FIELD,
        side,
        new Baseline(record.result.value, false),
      );
    }
  }
}
