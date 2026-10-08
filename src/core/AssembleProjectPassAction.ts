import type { CanonicalField } from './canonicalField.js';
import { Baseline } from './data/Baseline.js';
import type { DeclaredConnection } from './data/DeclaredConnection.js';
import { MirrorSide } from './data/MirrorSide.js';
import { MirrorSyncPass } from './data/MirrorSyncPass.js';
import type { PassRecord } from './data/PassRecord.js';
import type { RegisteredAdapter } from './data/RegisteredAdapter.js';
import { mirrorSideKey } from './mirrorSideKey.js';
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
    const notePaths = await this.projectSource.listEntities(project);
    const scoped = this.scopeMirrors(connections, project);

    const records: PassRecord[] = [];
    for (const notePath of notePaths) {
      const mirrors = await this.resolveMirrors(scoped, notePath);
      for (const field of MERGED_FIELDS) {
        records.push(await this.runField(notePath, field, mirrors));
      }
    }
    return records;
  }

  private scopeMirrors(
    connections: readonly DeclaredConnection[],
    project: string,
  ): ScopedMirror[] {
    const scoped: ScopedMirror[] = [];
    for (const connection of connections) {
      const adapter = this.mirrorAdapters.create(
        connection.envelope.application,
        connection.envelope.target,
        connection.slug,
        project,
      );
      if (adapter !== null) {
        scoped.push({ connection, adapter });
      }
    }
    return scoped;
  }

  private async resolveMirrors(
    scoped: readonly ScopedMirror[],
    notePath: string,
  ): Promise<MirrorSide[]> {
    const mirrors: MirrorSide[] = [];
    for (const { connection, adapter } of scoped) {
      const handle = await this.handles.resolve(connection.slug, notePath);
      if (handle !== null) {
        mirrors.push(
          new MirrorSide({
            side: mirrorSideKey(connection.slug),
            handle,
            adapter,
          }),
        );
      }
    }
    return mirrors;
  }

  private async runField(
    notePath: string,
    field: CanonicalField,
    mirrors: readonly MirrorSide[],
  ): Promise<PassRecord> {
    const origin = originSideObservation(
      ORIGIN_SIDE,
      await this.baselines.read(notePath, field, ORIGIN_SIDE),
      await this.origin.observe(notePath, field),
    );
    const baselines = await this.readMirrorBaselines(notePath, field, mirrors);
    const pass = new MirrorSyncPass({
      entityId: notePath,
      field,
      origin,
      mirrors,
      baselines,
    });

    const record = await new MirrorSyncAction(this.origin).invoke(pass);
    await this.persistAdvanced(notePath, field, record);
    return record;
  }

  private async readMirrorBaselines(
    notePath: string,
    field: CanonicalField,
    mirrors: readonly MirrorSide[],
  ): Promise<Map<string, Baseline>> {
    const baselines = new Map<string, Baseline>();
    for (const mirror of mirrors) {
      const baseline = await this.baselines.read(notePath, field, mirror.side);
      if (baseline !== null) {
        baselines.set(mirror.side, baseline);
      }
    }
    return baselines;
  }

  private async persistAdvanced(
    notePath: string,
    field: CanonicalField,
    record: PassRecord,
  ): Promise<void> {
    for (const side of record.advanced) {
      await this.baselines.write(
        notePath,
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
