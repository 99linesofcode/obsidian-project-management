import type { CanonicalField } from './canonicalField.js';
import { Baseline } from './data/Baseline.js';
import type { DeclaredConnection } from './data/DeclaredConnection.js';
import { MirrorSide } from './data/MirrorSide.js';
import { MirrorSyncPass } from './data/MirrorSyncPass.js';
import type { PassRecord } from './data/PassRecord.js';
import type { RegisteredAdapter } from './data/RegisteredAdapter.js';
import { MirrorSyncAction } from './MirrorSyncAction.js';
import { originSideObservation } from './originSideObservation.js';
import type { BaselineStorePort } from './ports/BaselineStorePort.js';
import type { MirrorAdapterFactoryPort } from './ports/MirrorAdapterFactoryPort.js';
import type { MirrorHandlePort } from './ports/MirrorHandlePort.js';
import type { OriginPort } from './ports/OriginPort.js';
import type { ProjectSourcePort } from './ports/ProjectSourcePort.js';

const ORIGIN_SIDE = 'origin';

const MERGED_FIELDS: readonly CanonicalField[] = [
  'title',
  'body',
  'subtasks',
  'completion',
  'Status',
  'label',
];

interface ScopedMirror {
  connection: DeclaredConnection;
  adapter: RegisteredAdapter;
}

export class AssembleProjectPassAction {
  constructor(
    private readonly projectSource: ProjectSourcePort,
    private readonly origin: OriginPort,
    private readonly baselines: BaselineStorePort,
    private readonly handles: MirrorHandlePort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
  ) {}

  async invoke(project: string): Promise<PassRecord[]> {
    const connections = await this.projectSource.readConnections(project);
    const entities = await this.projectSource.listEntities(project);
    const scoped = this.scopeMirrors(connections);

    const records: PassRecord[] = [];
    for (const entityId of entities) {
      const mirrors = await this.resolveMirrors(scoped, entityId);
      for (const field of MERGED_FIELDS) {
        records.push(await this.runField(entityId, field, mirrors));
      }
    }
    return records;
  }

  private scopeMirrors(
    connections: readonly DeclaredConnection[],
  ): ScopedMirror[] {
    const scoped: ScopedMirror[] = [];
    for (const connection of connections) {
      const adapter = this.mirrorAdapters.create(
        connection.envelope.application,
        connection.envelope.target,
      );
      if (adapter !== null) {
        scoped.push({ connection, adapter });
      }
    }
    return scoped;
  }

  private async resolveMirrors(
    scoped: readonly ScopedMirror[],
    entityId: string,
  ): Promise<MirrorSide[]> {
    const mirrors: MirrorSide[] = [];
    for (const { connection, adapter } of scoped) {
      const handle = await this.handles.resolve(connection.slug, entityId);
      if (handle !== null) {
        mirrors.push(
          new MirrorSide({ side: connection.slug, handle, adapter }),
        );
      }
    }
    return mirrors;
  }

  private async runField(
    entityId: string,
    field: CanonicalField,
    mirrors: readonly MirrorSide[],
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
    mirrors: readonly MirrorSide[],
  ): Promise<Map<string, Baseline>> {
    const baselines = new Map<string, Baseline>();
    for (const mirror of mirrors) {
      const baseline = await this.baselines.read(entityId, field, mirror.side);
      if (baseline !== null) {
        baselines.set(mirror.side, baseline);
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
