import type { CanonicalField } from './canonicalField.js';
import { Baseline } from './data/Baseline.js';
import { MirrorSyncPass } from './data/MirrorSyncPass.js';
import type { PassRecord } from './data/PassRecord.js';
import type { RegisteredAdapter } from './data/RegisteredAdapter.js';
import { MirrorSyncAction } from './MirrorSyncAction.js';
import { originSideObservation } from './originSideObservation.js';
import type { BaselineStorePort } from './ports/BaselineStorePort.js';
import type { OriginPort } from './ports/OriginPort.js';
import type { ProjectSourcePort } from './ports/ProjectSourcePort.js';

export const ORIGIN_SIDE = 'origin';

const MERGED_FIELDS: readonly CanonicalField[] = [
  'title',
  'body',
  'subtasks',
  'completion',
  'Status',
  'label',
];

export class AssembleProjectPassAction {
  constructor(
    private readonly projectSource: ProjectSourcePort,
    private readonly origin: OriginPort,
    private readonly baselines: BaselineStorePort,
    private readonly adapters: ReadonlyMap<string, RegisteredAdapter>,
  ) {}

  async invoke(project: string): Promise<PassRecord[]> {
    const connections = await this.projectSource.readConnections(project);
    const mirrors = connections
      .map((connection) => this.adapters.get(connection.application))
      .filter((adapter): adapter is RegisteredAdapter => adapter !== undefined);
    const entities = await this.projectSource.listEntities(project);

    const records: PassRecord[] = [];
    for (const entityId of entities) {
      for (const field of MERGED_FIELDS) {
        records.push(await this.runField(entityId, field, mirrors));
      }
    }
    return records;
  }

  private async runField(
    entityId: string,
    field: CanonicalField,
    mirrors: readonly RegisteredAdapter[],
  ): Promise<PassRecord> {
    const origin = originSideObservation(
      ORIGIN_SIDE,
      await this.baselines.read(entityId, field, ORIGIN_SIDE),
      await this.origin.observe(entityId, field),
    );
    const baselines = await this.readMirrorBaselines(entityId, field, mirrors);
    const pass = new MirrorSyncPass({
      entityId,
      field,
      origin,
      mirrors,
      baselines,
    });

    const record = await new MirrorSyncAction(this.origin).invoke(pass);
    await this.persistAdvanced(entityId, field, record);
    return record;
  }

  private async readMirrorBaselines(
    entityId: string,
    field: CanonicalField,
    mirrors: readonly RegisteredAdapter[],
  ): Promise<Map<string, Baseline>> {
    const baselines = new Map<string, Baseline>();
    for (const mirror of mirrors) {
      const baseline = await this.baselines.read(
        entityId,
        field,
        mirror.descriptor.applicationId,
      );
      if (baseline !== null) {
        baselines.set(mirror.descriptor.applicationId, baseline);
      }
    }
    return baselines;
  }

  private async persistAdvanced(
    entityId: string,
    field: CanonicalField,
    record: PassRecord,
  ): Promise<void> {
    for (const side of record.advanced) {
      await this.baselines.write(
        entityId,
        field,
        side,
        new Baseline(
          record.result.value,
          completedValue(field, record.result.value),
        ),
      );
    }
  }
}

function completedValue(field: CanonicalField, value: string | null): boolean {
  return field === 'completion' && value === 'true';
}
