import type { CanonicalField } from '../../domain/canonicalField.js';
import { Baseline } from '../../domain/Baseline.js';
import type { CanonicalTask } from '../../port/data/CanonicalTask.js';
import { CanonicalFieldWrite } from '../../port/data/CanonicalFieldWrite.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MergeResult } from '../../domain/MergeResult.js';
import { SideObservation } from '../../domain/SideObservation.js';
import { mergeField } from '../../domain/mergeField.js';
import { mirrorSideKey } from '../../domain/mirrorSideKey.js';
import { originSideObservation } from '../../domain/originSideObservation.js';
import { mirrorTrustsTimestamps } from './mirrorTrustsTimestamps.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../port/MirrorPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

const ORIGIN_SIDE = 'origin';

const PENDING_CREATION_PREFIX = 'pendingCreation:';

const MERGED_FIELDS: readonly CanonicalField[] = [
  'title',
  'body',
  'subtasks',
  'completion',
  'Status',
  'label',
];

interface ScopedMirror {
  connection: ConnectionDataTransferObject;
  adapter: MirrorPort;
}

interface ResolvedMirror {
  side: string;
  handle: string;
  adapter: MirrorPort;
}

export interface MirrorFieldOutcome {
  field: CanonicalField;
  result: MergeResult;
  written: readonly string[];
  advanced: readonly string[];
  failed: readonly string[];
}

// Reconciles every task field of a project's entities across the vault origin
// and each connection's mirror: resolves each connection's handle, merges the
// canonical fields through the ladder, writes the winner to the side that is
// behind, and advances each side's baseline only after its write resolved.
export class MirrorSyncAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
    private readonly mirrorAdapters: MirrorAdapterFactoryPort,
  ) {}

  async invoke(project: string): Promise<MirrorFieldOutcome[]> {
    const connections = await this.vault.readConnections(project);
    const notePaths = await this.vault.listEntities(project);
    const scoped = this.scopeMirrors(connections, project);

    const outcomes: MirrorFieldOutcome[] = [];
    for (const notePath of notePaths) {
      const mirrors = await this.resolveMirrors(scoped, notePath, project);
      for (const field of MERGED_FIELDS) {
        outcomes.push(await this.syncField(notePath, field, mirrors));
      }
    }
    return outcomes;
  }

  private scopeMirrors(
    connections: readonly ConnectionDataTransferObject[],
    project: string,
  ): ScopedMirror[] {
    const scoped: ScopedMirror[] = [];
    for (const connection of connections) {
      const adapter = this.mirrorAdapters.create(
        connection.application,
        connection.target,
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
    project: string,
  ): Promise<ResolvedMirror[]> {
    const mirrors: ResolvedMirror[] = [];
    for (const { connection, adapter } of scoped) {
      const handle = await this.resolveHandle(
        connection,
        adapter,
        notePath,
        project,
      );
      if (handle !== null) {
        mirrors.push({
          side: mirrorSideKey(connection.slug),
          handle,
          adapter,
        });
      }
    }
    return mirrors;
  }

  private async resolveHandle(
    connection: ConnectionDataTransferObject,
    adapter: MirrorPort,
    notePath: string,
    project: string,
  ): Promise<string | null> {
    const handle = await this.registry.resolveMirrorHandle(
      connection.slug,
      notePath,
    );
    if (handle !== null && !isPendingCreationHandle(handle)) {
      return handle;
    }
    try {
      return await this.materialize(
        connection,
        adapter,
        notePath,
        project,
        handle,
      );
    } catch (error) {
      console.error(
        `MirrorSyncAction: materialization failed for ${notePath}`,
        error,
      );
      return null;
    }
  }

  private async materialize(
    connection: ConnectionDataTransferObject,
    adapter: MirrorPort,
    notePath: string,
    project: string,
    pending: string | null,
  ): Promise<string | null> {
    const task = await this.vault.readTask(notePath);
    if (task === null) {
      return null;
    }
    if (pending !== null) {
      const adopted = await this.adopt(
        connection,
        adapter,
        notePath,
        project,
        task,
      );
      if (adopted !== null) {
        return adopted;
      }
    }
    await this.registry.recordMirrorHandle(
      project,
      connection.slug,
      notePath,
      pendingCreationHandle(notePath),
    );
    const created = await adapter.createTask(connection.target, task);
    await this.registry.recordMirrorHandle(
      project,
      connection.slug,
      notePath,
      created.handle,
    );
    return created.handle;
  }

  private async adopt(
    connection: ConnectionDataTransferObject,
    adapter: MirrorPort,
    notePath: string,
    project: string,
    task: CanonicalTask,
  ): Promise<string | null> {
    const candidates = await adapter.readTasks(connection.target);
    const match = candidates.find(
      (candidate) => candidate.title === task.title,
    );
    if (match === undefined) {
      return null;
    }
    await this.registry.recordMirrorHandle(
      project,
      connection.slug,
      notePath,
      match.handle,
    );
    return match.handle;
  }

  private async syncField(
    notePath: string,
    field: CanonicalField,
    mirrors: readonly ResolvedMirror[],
  ): Promise<MirrorFieldOutcome> {
    const origin = originSideObservation(
      ORIGIN_SIDE,
      await this.registry.readBaseline(notePath, field, ORIGIN_SIDE),
      await this.vault.observe(notePath, field),
    );
    const baselines = await this.readMirrorBaselines(notePath, field, mirrors);
    const observations: SideObservation[] = [];
    for (const mirror of mirrors) {
      observations.push(await observeMirror(mirror, field, baselines));
    }

    const result = mergeField(origin, observations);
    const fanout = await fanOut(mirrors, field, result);
    const originResult = await applyToOrigin(
      this.vault,
      notePath,
      field,
      origin,
      result,
    );

    const advanced = [...fanout.advanced];
    const failed = [...fanout.failed];
    if (originResult.advanced) {
      advanced.push(ORIGIN_SIDE);
    }
    if (originResult.failed) {
      failed.push(ORIGIN_SIDE);
    }

    await this.persistAdvanced(notePath, field, advanced, result);
    return { field, result, written: fanout.written, advanced, failed };
  }

  private async readMirrorBaselines(
    notePath: string,
    field: CanonicalField,
    mirrors: readonly ResolvedMirror[],
  ): Promise<Map<string, Baseline>> {
    const baselines = new Map<string, Baseline>();
    for (const mirror of mirrors) {
      const baseline = await this.registry.readBaseline(
        notePath,
        field,
        mirror.side,
      );
      if (baseline !== null) {
        baselines.set(mirror.side, baseline);
      }
    }
    return baselines;
  }

  private async persistAdvanced(
    notePath: string,
    field: CanonicalField,
    advanced: readonly string[],
    result: MergeResult,
  ): Promise<void> {
    for (const side of advanced) {
      await this.registry.writeBaseline(
        notePath,
        field,
        side,
        new Baseline(result.value, completedValue(field, result.value)),
      );
    }
  }
}

function pendingCreationHandle(notePath: string): string {
  return `${PENDING_CREATION_PREFIX}${notePath}`;
}

function isPendingCreationHandle(handle: string): boolean {
  return handle.startsWith(PENDING_CREATION_PREFIX);
}

function completedValue(field: CanonicalField, value: string | null): boolean {
  return field === 'completion' && value === 'true';
}

async function observeMirror(
  mirror: ResolvedMirror,
  field: CanonicalField,
  baselines: ReadonlyMap<string, Baseline>,
): Promise<SideObservation> {
  const task = await mirror.adapter.readTask(mirror.handle);
  const fieldTime = mirror.adapter.fieldTime
    ? await mirror.adapter.fieldTime(mirror.handle, field)
    : null;

  return new SideObservation({
    side: mirror.side,
    role: 'mirror',
    current: task === null ? null : canonicalValue(task, field),
    baseline: baselines.get(mirror.side) ?? null,
    fieldTime,
    timestampTrustworthy: mirrorTrustsTimestamps(mirror.adapter),
    completeFetch: mirror.adapter.fetchComplete?.() ?? false,
    currentCompleted: task === null ? false : task.completed,
  });
}

async function fanOut(
  mirrors: readonly ResolvedMirror[],
  field: CanonicalField,
  result: MergeResult,
): Promise<{ written: string[]; advanced: string[]; failed: string[] }> {
  const written: string[] = [];
  const advanced: string[] = [];
  const failed: string[] = [];

  if (result.outcome === 'value') {
    for (const mirror of mirrors) {
      const task = await mirror.adapter.readTask(mirror.handle);
      if (task !== null && canonicalValue(task, field) === result.value) {
        advanced.push(mirror.side);
        continue;
      }
      try {
        await mirror.adapter.applyField(
          new CanonicalFieldWrite({
            handle: mirror.handle,
            field,
            value: result.value,
          }),
        );
        written.push(mirror.side);
        advanced.push(mirror.side);
      } catch {
        failed.push(mirror.side);
      }
    }
  } else if (result.outcome === 'delete') {
    for (const mirror of mirrors) {
      const task = await mirror.adapter.readTask(mirror.handle);
      if (task === null) {
        advanced.push(mirror.side);
        continue;
      }
      try {
        await mirror.adapter.deleteTask(mirror.handle);
        written.push(mirror.side);
        advanced.push(mirror.side);
      } catch {
        failed.push(mirror.side);
      }
    }
  }

  return { written, advanced, failed };
}

async function applyToOrigin(
  origin: VaultPort,
  entityId: string,
  field: CanonicalField,
  originObservation: SideObservation,
  result: MergeResult,
): Promise<{ advanced: boolean; failed: boolean }> {
  if (result.outcome === 'unchanged') {
    return { advanced: false, failed: false };
  }

  if (result.outcome === 'value') {
    if (originObservation.current === result.value) {
      return { advanced: true, failed: false };
    }
    try {
      await origin.applyField(
        new CanonicalFieldWrite({
          handle: entityId,
          field,
          value: result.value,
        }),
      );
      return { advanced: true, failed: false };
    } catch {
      return { advanced: false, failed: true };
    }
  }

  if (originObservation.current === null) {
    return { advanced: true, failed: false };
  }
  try {
    await origin.trashNote(entityId);
    return { advanced: true, failed: false };
  } catch {
    return { advanced: false, failed: true };
  }
}

function canonicalValue(
  task: CanonicalTask,
  field: CanonicalField,
): string | null {
  switch (field) {
    case 'title':
      return task.title;
    case 'body':
      return task.body;
    case 'Status':
      return task.status;
    case 'completion':
      return task.completed ? 'true' : 'false';
    case 'subtasks':
      return task.parent;
    case 'label':
      return task.labels.join(',');
  }
}
