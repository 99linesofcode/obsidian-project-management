import { Baseline } from '../../domain/Baseline.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MergeResult } from '../../domain/MergeResult.js';
import { SideObservation } from '../../domain/SideObservation.js';
import { mergeField } from '../../domain/mergeField.js';
import { mirrorSideKey, originSideObservation } from '../../domain/sides.js';
import { mirrorTrustsTimestamps } from './mirrorTrustsTimestamps.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../port/MirrorPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

const ORIGIN_SIDE = 'origin';
const ARCHIVED_FIELD = 'archived';

interface ResolvedMirror {
  side: string;
  handle: string;
  adapter: MirrorPort;
}

interface ObservedMirror {
  mirror: ResolvedMirror;
  observation: SideObservation;
}

export interface ProjectLifecycleOutcome {
  frozen: boolean;
  wasFrozen: boolean;
  result: MergeResult;
  written: readonly string[];
  advanced: readonly string[];
  failed: readonly string[];
}

// Reconciles a project's archived state across the vault origin and N mirrors:
// resolves each connection's mirror project, merges the archive fact through the
// ladder, fans the verdict out to every side, and locks or unlocks the tracked
// issues that the archive transition calls for.
export class ProjectLifecycleSyncAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
  ) {}

  async invoke(project: string): Promise<ProjectLifecycleOutcome> {
    const connections = await this.vault.readConnections(project);
    const mirrors = await this.scopeMirrors(connections, project);
    const origin = originSideObservation(
      ORIGIN_SIDE,
      await this.registry.readBaseline(project, ARCHIVED_FIELD, ORIGIN_SIDE),
      await this.vault.observeProject(project),
    );
    const baselines = await this.readMirrorBaselines(project, mirrors);
    const observed = await this.observeMirrors(mirrors, baselines);

    const result = mergeField(
      origin,
      observed.map((entry) => entry.observation),
    );
    const fanout = await fanOut(observed, result);
    const originResult = await this.applyToOrigin(project, origin, result);

    const advanced = [...fanout.advanced];
    const failed = [...fanout.failed];
    if (originResult.advanced) {
      advanced.push(ORIGIN_SIDE);
    }
    if (originResult.failed) {
      failed.push(ORIGIN_SIDE);
    }

    await this.persistAdvanced(project, advanced, result);
    return {
      frozen: result.value === 'true',
      wasFrozen: origin.baseline?.value === 'true',
      result,
      written: fanout.written,
      advanced,
      failed,
    };
  }

  private async applyToOrigin(
    project: string,
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
      await this.vault.applyProjectArchived(project, archived);
      await relocateEntities(this.registry, project, archived);
      return { advanced: true, failed: false };
    } catch {
      return { advanced: false, failed: true };
    }
  }

  private async observeMirrors(
    mirrors: readonly ResolvedMirror[],
    baselines: ReadonlyMap<string, Baseline>,
  ): Promise<ObservedMirror[]> {
    const observed: ObservedMirror[] = [];
    for (const mirror of mirrors) {
      const observation = await observeMirror(mirror, baselines);
      if (observation !== null) {
        observed.push({ mirror, observation });
      }
    }
    return observed;
  }

  private async scopeMirrors(
    connections: readonly ConnectionDataTransferObject[],
    project: string,
  ): Promise<ResolvedMirror[]> {
    const mirrors: ResolvedMirror[] = [];
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
      try {
        mirrors.push({
          side: mirrorSideKey(connection.slug),
          handle: await this.resolveProject(connection, adapter, project),
          adapter,
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
    adapter: MirrorPort,
    project: string,
  ): Promise<string> {
    const recorded = await this.registry.resolveMirrorProject(
      project,
      connection.slug,
    );
    if (recorded !== null) {
      await this.renameIfDrifted(adapter, recorded, project);
      return recorded;
    }

    const existing = await adapter.readProject(connection.target);
    if (existing !== null) {
      await this.renameIfDrifted(adapter, connection.target, project);
      await this.record(connection, project, connection.target);
      return connection.target;
    }

    const created = await adapter.createProject(connection.target, project);
    await this.record(connection, project, created.handle);
    return created.handle;
  }

  private async renameIfDrifted(
    adapter: MirrorPort,
    handle: string,
    project: string,
  ): Promise<void> {
    const mirror = await adapter.readProject(handle);
    if (mirror !== null && mirror.name !== project) {
      await adapter.renameProject(handle, project);
    }
  }

  private async record(
    connection: ConnectionDataTransferObject,
    project: string,
    handle: string,
  ): Promise<void> {
    await this.registry.recordMirrorProject(
      project,
      connection.slug,
      connection.application,
      handle,
    );
  }

  private async readMirrorBaselines(
    project: string,
    mirrors: readonly ResolvedMirror[],
  ): Promise<Map<string, Baseline>> {
    const baselines = new Map<string, Baseline>();
    for (const mirror of mirrors) {
      const baseline = await this.registry.readBaseline(
        project,
        ARCHIVED_FIELD,
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
    advanced: readonly string[],
    result: MergeResult,
  ): Promise<void> {
    for (const side of advanced) {
      await this.registry.writeBaseline(
        project,
        ARCHIVED_FIELD,
        side,
        new Baseline(result.value, false),
      );
    }
  }
}

async function relocateEntities(
  registry: RegistryPort,
  project: string,
  archived: boolean,
): Promise<void> {
  const from = archived ? 'Projecten' : 'Archief';
  const to = archived ? 'Archief' : 'Projecten';
  const fromPrefix = `${from}/${project}/`;
  const toPrefix = `${to}/${project}/`;

  for (const record of await registry.listEntities(project)) {
    if (record.notePath.startsWith(fromPrefix)) {
      await registry.setEntity({
        ...record,
        notePath: `${toPrefix}${record.notePath.slice(fromPrefix.length)}`,
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

  return new SideObservation({
    side: mirror.side,
    role: 'mirror',
    current: project.archived ? 'true' : 'false',
    baseline: baselines.get(mirror.side) ?? null,
    fieldTime: await mirror.adapter.archivedTime(mirror.handle),
    timestampTrustworthy: mirrorTrustsTimestamps(mirror.adapter),
    completeFetch: mirror.adapter.fetchComplete?.() ?? false,
    currentCompleted: false,
  });
}

async function fanOut(
  observed: readonly ObservedMirror[],
  result: MergeResult,
): Promise<{ written: string[]; advanced: string[]; failed: string[] }> {
  const written: string[] = [];
  const advanced: string[] = [];
  const failed: string[] = [];

  if (result.outcome !== 'value') {
    return { written, advanced, failed };
  }

  const archived = result.value === 'true';
  for (const { mirror, observation } of observed) {
    if (observation.current === result.value) {
      advanced.push(mirror.side);
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
