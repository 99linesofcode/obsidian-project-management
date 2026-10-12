import type { MergeResult } from '../../domain/MergeResult.js';
import type { MirrorSide } from '../data/MirrorSide.js';
import type { ProjectLifecyclePass } from '../data/ProjectLifecyclePass.js';
import { ProjectLifecycleRecord } from '../data/ProjectLifecycleRecord.js';
import { SideObservation } from '../../domain/SideObservation.js';
import { mergeField } from '../../domain/mergeField.js';
import { mirrorTrustsTimestamps } from './mirrorTrustsTimestamps.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

interface ObservedMirror {
  mirror: MirrorSide;
  observation: SideObservation;
}

export class ProjectLifecycleSyncAction {
  constructor(
    private readonly origin: VaultPort,
    private readonly registry: RegistryPort,
  ) {}

  async invoke(pass: ProjectLifecyclePass): Promise<ProjectLifecycleRecord> {
    const observed = await this.observeMirrors(pass);
    const result = mergeField(
      pass.origin,
      observed.map((entry) => entry.observation),
    );
    const mirrors = await fanOut(observed, result);
    const originResult = await this.applyToOrigin(pass, result);

    const advanced = [...mirrors.advanced];
    const failed = [...mirrors.failed];
    if (originResult.advanced) {
      advanced.push(pass.origin.side);
    }
    if (originResult.failed) {
      failed.push(pass.origin.side);
    }

    return new ProjectLifecycleRecord({
      frozen: result.value === 'true',
      wasFrozen: pass.origin.baseline?.value === 'true',
      result,
      written: mirrors.written,
      advanced,
      failed,
    });
  }

  private async applyToOrigin(
    pass: ProjectLifecyclePass,
    result: MergeResult,
  ): Promise<{ advanced: boolean; failed: boolean }> {
    if (result.outcome === 'unchanged') {
      return { advanced: false, failed: false };
    }
    if (pass.origin.current === result.value) {
      return { advanced: true, failed: false };
    }

    const archived = result.value === 'true';
    try {
      await this.origin.applyProjectArchived(pass.project, archived);
      await relocateEntities(this.registry, pass.project, archived);
      return { advanced: true, failed: false };
    } catch {
      return { advanced: false, failed: true };
    }
  }

  private async observeMirrors(
    pass: ProjectLifecyclePass,
  ): Promise<ObservedMirror[]> {
    const observed: ObservedMirror[] = [];
    for (const mirror of pass.mirrors) {
      const observation = await observeMirror(mirror, pass);
      if (observation !== null) {
        observed.push({ mirror, observation });
      }
    }
    return observed;
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
  mirror: MirrorSide,
  pass: ProjectLifecyclePass,
): Promise<SideObservation | null> {
  const project = await mirror.adapter.readProject(mirror.handle);
  if (project === null) {
    return null;
  }

  return new SideObservation({
    side: mirror.side,
    role: 'mirror',
    current: project.archived ? 'true' : 'false',
    baseline: pass.baselines.get(mirror.side) ?? null,
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
