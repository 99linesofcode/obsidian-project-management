import { Baseline } from '../../domain/Baseline.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MergeResult } from '../../domain/MergeResult.js';
import { SideObservation } from '../../domain/SideObservation.js';
import {
  mirrorSideKey,
  originSideObservation,
  ORIGIN_SIDE,
} from '../../domain/sides.js';
import { mirrorTrustsArchiveTime } from './mirrorTrustsTimestamps.js';
import type { ResolvedMirror } from '../resolvedMirror.js';
import type { ProjectReferenceDataTransferObject } from '../data/ProjectReferenceDataTransferObject.js';
import { MergePassService } from '../services/MergePassService.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../port/MirrorPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

const ARCHIVED_FIELD = 'archived';

interface ResolvedProject {
  handle: string;
}

export interface ProjectLifecycleOutcome {
  frozen: boolean;
  wasFrozen: boolean;
  result: MergeResult;
  written: readonly string[];
  advanced: readonly string[];
  failed: readonly string[];
}

export class ProjectLifecycleSyncAction {
  private readonly mergePass: MergePassService;

  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
    mirrorAdapters: MirrorAdapterFactoryPort,
  ) {
    this.mergePass = new MergePassService(registry, mirrorAdapters);
  }

  async invoke(
    project: ProjectReferenceDataTransferObject,
  ): Promise<ProjectLifecycleOutcome> {
    const connections = await this.vault.readConnections(project.projectId);
    const mirrors = await this.scopeMirrors(connections, project);
    const origin = originSideObservation(
      ORIGIN_SIDE,
      await this.registry.readBaseline(
        project.projectId,
        ARCHIVED_FIELD,
        ORIGIN_SIDE,
      ),
      await this.vault.observeProject(project.projectId),
    );

    const pass = await this.mergePass.reconcile(
      project.projectId,
      ARCHIVED_FIELD,
      origin,
      mirrors,
      {
        observeSide: (mirror, baselines) => observeMirror(mirror, baselines),
        fanOut: ({ mirrors: sides, observations }, result) =>
          fanOut(sides, observations, result),
        applyOrigin: (result) =>
          this.applyToOrigin(project.projectId, origin, result),
        baselineFor: (result) => new Baseline(result.value, false),
      },
    );

    return {
      frozen: pass.result.value === 'true',
      wasFrozen: origin.baseline?.value === 'true',
      result: pass.result,
      written: pass.written,
      advanced: pass.advanced,
      failed: pass.failed,
    };
  }

  private async applyToOrigin(
    projectId: string,
    origin: SideObservation,
    result: MergeResult,
  ): Promise<{ advanced: boolean; failed: boolean }> {
    if (result.outcome === 'unchanged') {
      return { advanced: false, failed: false };
    }
    if (origin.current === result.value) {
      return { advanced: true, failed: false };
    }

    const archived = result.value === 'true';
    try {
      await this.vault.applyProjectArchived(projectId, archived);
      await relocateEntities(this.registry, projectId, archived);
      return { advanced: true, failed: false };
    } catch {
      return { advanced: false, failed: true };
    }
  }

  private async scopeMirrors(
    connections: readonly ConnectionDataTransferObject[],
    project: ProjectReferenceDataTransferObject,
  ): Promise<ResolvedMirror[]> {
    const mirrors: ResolvedMirror[] = [];
    for (const connection of connections) {
      const scoped = await this.mergePass.scopeConnection(
        project.projectId,
        connection,
      );
      if (scoped === null) {
        continue;
      }
      try {
        const resolved = await this.resolveProject(
          scoped.connection,
          scoped.target,
          scoped.adapter,
          project,
        );
        if (resolved === null) {
          continue;
        }
        mirrors.push({
          slug: connection.slug,
          side: mirrorSideKey(connection.slug),
          handle: resolved.handle,
          adapter: scoped.adapter,
        });
      } catch (error) {
        console.error(
          `ProjectLifecycleSyncAction: connection ${connection.slug} failed`,
          error,
        );
      }
    }
    return mirrors;
  }

  private async resolveProject(
    connection: ConnectionDataTransferObject,
    target: string,
    adapter: MirrorPort,
    project: ProjectReferenceDataTransferObject,
  ): Promise<ResolvedProject | null> {
    const recorded = await this.registry.resolveMirrorProject(
      project.projectId,
      connection.slug,
    );
    if (recorded !== null) {
      await this.renameIfDrifted(adapter, recorded, project.projectName);
      return { handle: recorded };
    }

    const existing = await adapter.readProject(target);
    if (existing === null) {
      return null;
    }
    await this.renameIfDrifted(adapter, target, project.projectName);
    await this.record(connection, project.projectId, target);
    return { handle: target };
  }

  private async renameIfDrifted(
    adapter: MirrorPort,
    handle: string,
    projectName: string,
  ): Promise<void> {
    const mirror = await adapter.readProject(handle);
    if (mirror !== null && mirror.name !== projectName) {
      await adapter.renameProject(handle, projectName);
    }
  }

  private async record(
    connection: ConnectionDataTransferObject,
    projectId: string,
    handle: string,
  ): Promise<void> {
    await this.registry.recordMirrorProject(
      projectId,
      connection.slug,
      connection.application,
      handle,
    );
  }
}

async function relocateEntities(
  registry: RegistryPort,
  projectId: string,
  archived: boolean,
): Promise<void> {
  const from = archived ? 'Projecten' : 'Archief';
  const to = archived ? 'Archief' : 'Projecten';

  for (const record of await registry.listEntities(projectId)) {
    if (record.notePath.startsWith(`${from}/`)) {
      const rest = record.notePath.slice(`${from}/`.length);
      await registry.setEntity({
        ...record,
        notePath: `${to}/${rest}`,
      });
    }
  }
}

async function observeMirror(
  mirror: ResolvedMirror,
  baselines: ReadonlyMap<string, Baseline>,
): Promise<SideObservation | null> {
  const project = await mirror.adapter.readProject(mirror.handle);
  if (project === null) {
    return null;
  }

  const projectTime = mirror.adapter.projectTime
    ? await mirror.adapter.projectTime(mirror.handle)
    : null;

  return new SideObservation({
    side: mirror.side,
    role: 'mirror',
    current: project.archived ? 'true' : 'false',
    baseline: baselines.get(mirror.side) ?? null,
    fieldTime: projectTime,
    timestampTrustworthy: mirrorTrustsArchiveTime(mirror.adapter, projectTime),
    completeFetch: mirror.adapter.fetchComplete?.() ?? false,
    currentCompleted: false,
  });
}

async function fanOut(
  mirrors: readonly ResolvedMirror[],
  observations: readonly SideObservation[],
  result: MergeResult,
): Promise<{ written: string[]; advanced: string[]; failed: string[] }> {
  const written: string[] = [];
  const advanced: string[] = [];
  const failed: string[] = [];
  const observedBySide = new Map(
    observations.map((observation) => [observation.side, observation]),
  );

  const archived = result.value === 'true';
  for (const mirror of mirrors) {
    const current = observedBySide.get(mirror.side)?.current ?? null;
    if (current === null) {
      continue;
    }
    if (current === result.value) {
      if (result.outcome === 'value') {
        advanced.push(mirror.side);
      }
      continue;
    }
    try {
      await mirror.adapter.setArchived(mirror.handle, archived);
      written.push(mirror.side);
      advanced.push(mirror.side);
    } catch {
      failed.push(mirror.side);
    }
  }

  return { written, advanced, failed };
}
