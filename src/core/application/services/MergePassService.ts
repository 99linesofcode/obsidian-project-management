import type { Baseline } from '../../domain/Baseline.js';
import type { MergedField } from '../../domain/canonicalField.js';
import type { MergeResult } from '../../domain/MergeResult.js';
import { mergeField } from '../../domain/mergeField.js';
import type { SideObservation } from '../../domain/SideObservation.js';
import { ORIGIN_SIDE } from '../../domain/sides.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../port/MirrorPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { ResolvedMirror } from '../resolvedMirror.js';
import { effectiveConnectionTarget } from './connectionTarget.js';

export interface ScopedMirror {
  connection: ConnectionDataTransferObject;
  target: string;
  adapter: MirrorPort;
}

export interface MergeFanout {
  written: string[];
  advanced: string[];
  failed: string[];
}

export interface MergeOriginResult {
  advanced: boolean;
  failed: boolean;
}

export interface MergeSides {
  mirrors: readonly ResolvedMirror[];
  observations: readonly SideObservation[];
}

// The variable half of a merge pass — how a side is observed, how the reconciled
// verdict reaches the mirrors, how it reaches the origin, and the baseline the
// advanced sides record. Each action brings its own; the driver owns everything
// between them.
export interface MergePlan {
  observeSide(
    mirror: ResolvedMirror,
    baselines: ReadonlyMap<string, Baseline>,
  ): Promise<SideObservation | null>;
  fanOut(sides: MergeSides, result: MergeResult): Promise<MergeFanout>;
  applyOrigin(result: MergeResult): Promise<MergeOriginResult>;
  baselineFor(result: MergeResult): Baseline;
}

export interface MergePassOutcome {
  result: MergeResult;
  written: readonly string[];
  advanced: readonly string[];
  failed: readonly string[];
}

// The spine both merge actions run: scope a declared connection to its effective
// target and adapter, read every side's baseline, observe the sides, merge the
// one field through the ladder, fan the verdict out, apply it to the origin, and
// persist each advanced side's baseline. The action supplies the variable half —
// the observation, the fan-out, the origin write and the baseline it records —
// so the field merge and the archive merge are each their own merge over this
// driver.
export class MergePassService {
  constructor(
    private readonly registry: RegistryPort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
  ) {}

  async scopeConnection(
    project: string,
    connection: ConnectionDataTransferObject,
  ): Promise<ScopedMirror | null> {
    const target = await effectiveConnectionTarget(
      this.registry,
      project,
      connection,
    );
    if (target === null) {
      return null;
    }
    const adapter = this.mirrorAdapters.create(
      connection.application,
      target,
      connection.slug,
      project,
    );
    return adapter === null ? null : { connection, target, adapter };
  }

  async reconcile(
    entityKey: string,
    field: MergedField,
    origin: SideObservation,
    mirrors: readonly ResolvedMirror[],
    plan: MergePlan,
  ): Promise<MergePassOutcome> {
    const baselines = await this.readBaselines(entityKey, field, mirrors);
    const observations = await this.observeSides(mirrors, baselines, plan);
    const result = mergeField(origin, observations);
    const fanout = await plan.fanOut({ mirrors, observations }, result);
    const originResult = await plan.applyOrigin(result);
    const { advanced, failed } = foldOriginResult(fanout, originResult);

    await this.persistAdvanced(entityKey, field, advanced, result, plan);
    return { result, written: fanout.written, advanced, failed };
  }

  private async readBaselines(
    entityKey: string,
    field: MergedField,
    mirrors: readonly ResolvedMirror[],
  ): Promise<Map<string, Baseline>> {
    const baselines = new Map<string, Baseline>();
    for (const mirror of mirrors) {
      const baseline = await this.registry.readBaseline(
        entityKey,
        field,
        mirror.side,
      );
      if (baseline !== null) {
        baselines.set(mirror.side, baseline);
      }
    }
    return baselines;
  }

  private async observeSides(
    mirrors: readonly ResolvedMirror[],
    baselines: ReadonlyMap<string, Baseline>,
    plan: MergePlan,
  ): Promise<SideObservation[]> {
    const observations: SideObservation[] = [];
    for (const mirror of mirrors) {
      const observation = await plan.observeSide(mirror, baselines);
      if (observation !== null) {
        observations.push(observation);
      }
    }
    return observations;
  }

  private async persistAdvanced(
    entityKey: string,
    field: MergedField,
    advanced: readonly string[],
    result: MergeResult,
    plan: MergePlan,
  ): Promise<void> {
    for (const side of advanced) {
      await this.registry.writeBaseline(
        entityKey,
        field,
        side,
        plan.baselineFor(result),
      );
    }
  }
}

function foldOriginResult(
  fanout: MergeFanout,
  originResult: MergeOriginResult,
): { advanced: string[]; failed: string[] } {
  const advanced = [...fanout.advanced];
  const failed = [...fanout.failed];
  if (originResult.advanced) {
    advanced.push(ORIGIN_SIDE);
  }
  if (originResult.failed) {
    failed.push(ORIGIN_SIDE);
  }
  return { advanced, failed };
}
