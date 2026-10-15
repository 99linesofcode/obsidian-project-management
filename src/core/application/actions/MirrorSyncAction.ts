import type { CanonicalField } from '../../domain/canonicalField.js';
import { Baseline } from '../../domain/Baseline.js';
import { CanonicalTask } from '../../port/data/CanonicalTask.js';
import { CanonicalFieldWrite } from '../../port/data/CanonicalFieldWrite.js';
import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { MergeResult } from '../../domain/MergeResult.js';
import { OriginObservation } from '../../domain/OriginObservation.js';
import { SideObservation } from '../../domain/SideObservation.js';
import { labelSequence, stemOf, typeFromLabels } from '../../domain/note.js';
import {
  mirrorSideKey,
  originSideObservation,
  ORIGIN_SIDE,
} from '../../domain/sides.js';
import { mirrorTrustsTimestamps } from './mirrorTrustsTimestamps.js';
import type { ResolvedMirror } from '../resolvedMirror.js';
import {
  MergePassService,
  type ScopedMirror,
} from '../services/MergePassService.js';
import type { MirrorAdapterFactoryPort } from '../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../port/MirrorPort.js';
import type { RegistryPort } from '../../port/RegistryPort.js';
import type { VaultPort } from '../../port/VaultPort.js';

const PENDING_CREATION_PREFIX = 'pendingCreation:';

const MERGED_FIELDS: readonly CanonicalField[] = [
  'title',
  'body',
  'subtasks',
  'completion',
  'Status',
  'label',
];

// The value space a field's canonical value lives in, per side. Most fields
// carry the same raw value everywhere; `subtasks` carries the parent's
// identity, which each side renders in its own space — the origin a wikilink
// stem, the mirror a handle.
interface FieldCodec {
  originCurrent(raw: string | null): Promise<string | null>;
  mirrorCurrent(slug: string, raw: string | null): Promise<string | null>;
  originValue(identity: string | null): string | null;
  mirrorValue(slug: string, identity: string | null): Promise<string | null>;
}

const IDENTITY_CODEC: FieldCodec = {
  originCurrent: async (raw) => raw,
  mirrorCurrent: async (_slug, raw) => raw,
  originValue: (identity) => identity,
  mirrorValue: async (_slug, identity) => identity,
};

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
  private readonly mergePass: MergePassService;

  constructor(
    private readonly vault: VaultPort,
    private readonly registry: RegistryPort,
    mirrorAdapters: MirrorAdapterFactoryPort,
  ) {
    this.mergePass = new MergePassService(registry, mirrorAdapters);
  }

  async invoke(project: string): Promise<MirrorFieldOutcome[]> {
    const connections = await this.vault.readConnections(project);
    const notePaths = await this.vault.listEntities(project);
    const scoped = await this.scopeMirrors(connections, project);

    const outcomes: MirrorFieldOutcome[] = [];
    for (const notePath of notePaths) {
      outcomes.push(...(await this.syncEntity(notePath, scoped, project)));
    }
    return outcomes;
  }

  private async syncEntity(
    notePath: string,
    scoped: readonly ScopedMirror[],
    project: string,
  ): Promise<MirrorFieldOutcome[]> {
    const mirrors = await this.resolveMirrors(scoped, notePath, project);
    const outcomes: MirrorFieldOutcome[] = [];
    for (const field of MERGED_FIELDS) {
      outcomes.push(await this.syncField(notePath, field, mirrors, project));
    }
    return outcomes;
  }

  private async scopeMirrors(
    connections: readonly ConnectionDataTransferObject[],
    project: string,
  ): Promise<ScopedMirror[]> {
    const scoped: ScopedMirror[] = [];
    for (const connection of connections) {
      const mirror = await this.mergePass.scopeConnection(project, connection);
      if (mirror !== null) {
        scoped.push(mirror);
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
    for (const { connection, target, adapter } of scoped) {
      const handle = await this.resolveHandle(
        connection,
        target,
        adapter,
        notePath,
        project,
      );
      if (handle !== null) {
        mirrors.push({
          slug: connection.slug,
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
    target: string,
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
        target,
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
    target: string,
    adapter: MirrorPort,
    notePath: string,
    project: string,
    pending: string | null,
  ): Promise<string | null> {
    const task = await this.vault.readTask(notePath);
    if (task === null) {
      return null;
    }
    if (isTodo(task) && this.todoIsUntracked(adapter)) {
      return null;
    }
    if (pending !== null) {
      const adopted = await this.adopt(
        connection,
        target,
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
    const created = await adapter.createTask(
      target,
      await this.withMirrorParent(task, connection, project),
    );
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
    target: string,
    adapter: MirrorPort,
    notePath: string,
    project: string,
    task: CanonicalTask,
  ): Promise<string | null> {
    const candidates = await adapter.readTasks(target);
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
    project: string,
  ): Promise<MirrorFieldOutcome> {
    const codec =
      field === 'subtasks' ? this.parentCodec(project) : IDENTITY_CODEC;
    const observed = await this.vault.observe(notePath, field);
    const originCurrent = await codec.originCurrent(observed.current);
    const origin = originSideObservation(
      ORIGIN_SIDE,
      await this.registry.readBaseline(notePath, field, ORIGIN_SIDE),
      new OriginObservation({
        current: originCurrent,
        currentCompleted: observed.currentCompleted,
        fieldTime: observed.fieldTime,
        trustworthy: observed.trustworthy,
      }),
    );

    const pass = await this.mergePass.reconcile(
      notePath,
      field,
      origin,
      mirrors,
      {
        observeSide: (mirror, baselines) =>
          observeMirror(mirror, field, baselines, codec),
        fanOut: ({ mirrors: sides }, result) =>
          fanOut(sides, field, result, codec),
        applyOrigin: (result) =>
          applyToOrigin(
            this.vault,
            notePath,
            field,
            originCurrent,
            result,
            codec,
          ),
        baselineFor: (result) =>
          new Baseline(result.value, completedValue(field, result.value)),
      },
    );

    return {
      field,
      result: pass.result,
      written: pass.written,
      advanced: pass.advanced,
      failed: pass.failed,
    };
  }

  // The `subtasks` codec: the canonical value is the parent's identity — its
  // note path — so the origin's wikilink stem and the mirror's handle, two
  // renderings of one relation, are compared and settled by identity.
  private parentCodec(project: string): FieldCodec {
    return {
      originCurrent: (raw) => this.originParentIdentity(project, raw),
      mirrorCurrent: (slug, raw) => this.mirrorParentIdentity(slug, raw),
      originValue: (identity) => (identity === null ? null : stemOf(identity)),
      mirrorValue: (slug, identity) => this.renderMirrorParent(slug, identity),
    };
  }

  private async renderMirrorParent(
    slug: string,
    identity: string | null,
  ): Promise<string | null> {
    if (identity === null) {
      return null;
    }
    return this.registry.resolveMirrorHandle(slug, identity);
  }

  private todoIsUntracked(adapter: MirrorPort): boolean {
    return adapter.materializesTodo?.() === false;
  }

  private async withMirrorParent(
    task: CanonicalTask,
    connection: ConnectionDataTransferObject,
    project: string,
  ): Promise<CanonicalTask> {
    if (task.parent === null) {
      return task;
    }
    const identity = await this.originParentIdentity(project, task.parent);
    if (identity === null) {
      return task;
    }
    const handle = await this.registry.resolveMirrorHandle(
      connection.slug,
      identity,
    );
    if (handle === null) {
      return task;
    }
    return new CanonicalTask({
      handle: task.handle,
      entityId: task.entityId,
      title: task.title,
      body: task.body,
      status: task.status,
      completed: task.completed,
      parent: handle,
      labels: task.labels,
    });
  }

  private async originParentIdentity(
    project: string,
    raw: string | null,
  ): Promise<string | null> {
    if (raw === null) {
      return null;
    }
    const entities = await this.registry.listEntities(project);
    const parent = entities.find((entity) => stemOf(entity.notePath) === raw);
    return parent?.notePath ?? null;
  }

  private async mirrorParentIdentity(
    slug: string,
    raw: string | null,
  ): Promise<string | null> {
    if (raw === null) {
      return null;
    }
    const item = await this.registry.findMirrorItem(slug, raw);
    if (item === null) {
      return null;
    }
    const entity = await this.registry.getEntity(item.entityId);
    return entity?.notePath ?? null;
  }
}

function pendingCreationHandle(notePath: string): string {
  return `${PENDING_CREATION_PREFIX}${notePath}`;
}

function isPendingCreationHandle(handle: string): boolean {
  return handle.startsWith(PENDING_CREATION_PREFIX);
}

function isTodo(task: CanonicalTask): boolean {
  return typeFromLabels(task.labels) === 'todo';
}

function completedValue(field: CanonicalField, value: string | null): boolean {
  return field === 'completion' && value === 'true';
}

async function observeMirror(
  mirror: ResolvedMirror,
  field: CanonicalField,
  baselines: ReadonlyMap<string, Baseline>,
  codec: FieldCodec,
): Promise<SideObservation> {
  const task = await mirror.adapter.readTask(mirror.handle);
  const fieldTime = mirror.adapter.fieldTime
    ? await mirror.adapter.fieldTime(mirror.handle, field)
    : null;

  return new SideObservation({
    side: mirror.side,
    role: 'mirror',
    current: await codec.mirrorCurrent(
      mirror.slug,
      task === null ? null : canonicalValue(task, field),
    ),
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
  codec: FieldCodec,
): Promise<{ written: string[]; advanced: string[]; failed: string[] }> {
  const written: string[] = [];
  const advanced: string[] = [];
  const failed: string[] = [];

  if (result.outcome === 'value') {
    for (const mirror of mirrors) {
      const task = await mirror.adapter.readTask(mirror.handle);
      const current = await codec.mirrorCurrent(
        mirror.slug,
        task === null ? null : canonicalValue(task, field),
      );
      if (current === result.value) {
        advanced.push(mirror.side);
        continue;
      }
      try {
        await mirror.adapter.applyField(
          new CanonicalFieldWrite({
            handle: mirror.handle,
            field,
            value: await codec.mirrorValue(mirror.slug, result.value),
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
  originCurrent: string | null,
  result: MergeResult,
  codec: FieldCodec,
): Promise<{ advanced: boolean; failed: boolean }> {
  if (result.outcome === 'unchanged') {
    return { advanced: false, failed: false };
  }

  if (result.outcome === 'value') {
    if (originCurrent === result.value) {
      return { advanced: true, failed: false };
    }
    try {
      await origin.applyField(
        new CanonicalFieldWrite({
          handle: entityId,
          field,
          value: codec.originValue(result.value),
        }),
      );
      return { advanced: true, failed: false };
    } catch {
      return { advanced: false, failed: true };
    }
  }

  if (originCurrent === null) {
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
      return labelSequence(task.labels);
  }
}
