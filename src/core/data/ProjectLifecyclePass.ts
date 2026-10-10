import type { Baseline } from './Baseline.js';
import type { MirrorSide } from './MirrorSide.js';
import type { SideObservation } from './SideObservation.js';

export class ProjectLifecyclePass {
  readonly project: string;
  readonly origin: SideObservation;
  readonly mirrors: readonly MirrorSide[];
  readonly baselines: ReadonlyMap<string, Baseline>;

  constructor(init: {
    project: string;
    origin: SideObservation;
    mirrors: readonly MirrorSide[];
    baselines: ReadonlyMap<string, Baseline>;
  }) {
    this.project = init.project;
    this.origin = init.origin;
    this.mirrors = init.mirrors;
    this.baselines = init.baselines;
  }
}
