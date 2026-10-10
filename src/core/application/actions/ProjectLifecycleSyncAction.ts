import type { MergeResult } from '../../domain/MergeResult.js';
import type { MirrorSide } from '../data/MirrorSide.js';
import type { ProjectLifecyclePass } from '../data/ProjectLifecyclePass.js';
import { ProjectLifecycleRecord } from '../data/ProjectLifecycleRecord.js';
import { SideObservation } from '../../domain/SideObservation.js';
import { mergeField } from '../../domain/mergeField.js';
import type { ProjectLifecycleOriginPort } from '../../port/ProjectLifecycleOriginPort.js';

interface ObservedMirror {
  mirror: MirrorSide;
  observation: SideObservation;
}

export class ProjectLifecycleSyncAction {
  constructor(private readonly origin: ProjectLifecycleOriginPort) {}

  async invoke(pass: ProjectLifecyclePass): Promise<ProjectLifecycleRecord> {
    const observed = await this.observeMirrors(pass);
    const result = mergeField(
      pass.origin,
      observed.map((entry) => entry.observation),
    );
    const mirrors = await fanOut(observed, result);
    const originResult = await applyToOrigin(this.origin, pass, result);

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

  private async observeMirrors(
    pass: ProjectLifecyclePass,
  ): Promise<ObservedMirror[]> {
    const observed: ObservedMirror[] = [];
    for (const mirror of pass.mirrors) {
      if (!mirror.adapter.descriptor.capabilities.includes('lifecycle')) {
        continue;
      }
      const observation = await observeMirror(mirror, pass);
      if (observation !== null) {
        observed.push({ mirror, observation });
      }
    }
    return observed;
  }
}

async function observeMirror(
  mirror: MirrorSide,
  pass: ProjectLifecyclePass,
): Promise<SideObservation | null> {
  const project = await mirror.adapter.project.readProject(mirror.handle);
  if (project === null) {
    return null;
  }

  return new SideObservation({
    side: mirror.side,
    role: 'mirror',
    current: project.archived ? 'true' : 'false',
    baseline: pass.baselines.get(mirror.side) ?? null,
    fieldTime: await mirror.adapter.project.archivedTime(mirror.handle),
    timestampTrustworthy: mirror.adapter.descriptor.capabilities.includes(
      'trustworthy per-field timestamps',
    ),
    completeFetch: mirror.adapter.completeFetch
      ? mirror.adapter.completeFetch.fetchComplete()
      : false,
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
      await mirror.adapter.project.setArchived(mirror.handle, archived);
      written.push(mirror.side);
      advanced.push(mirror.side);
    } catch {
      failed.push(mirror.side);
    }
  }

  return { written, advanced, failed };
}

async function applyToOrigin(
  origin: ProjectLifecycleOriginPort,
  pass: ProjectLifecyclePass,
  result: MergeResult,
): Promise<{ advanced: boolean; failed: boolean }> {
  if (result.outcome === 'unchanged') {
    return { advanced: false, failed: false };
  }
  if (pass.origin.current === result.value) {
    return { advanced: true, failed: false };
  }

  try {
    await origin.applyProjectArchived(pass.project, result.value === 'true');
    return { advanced: true, failed: false };
  } catch {
    return { advanced: false, failed: true };
  }
}
