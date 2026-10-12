import { describe, expect, it } from 'vitest';
import type { CanonicalField } from '../../../../src/core/domain/canonicalField.js';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import type { CanonicalFieldWrite } from '../../../../src/core/port/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { SyncStateAdapter } from '../../../../src/infrastructure/registry/SyncStateAdapter.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const PROJECT = 'Acme';
const ENTITY = 'Projecten/Acme/taken/fix-the-bug.md';
const HANDLE = 't1';

const MERGED_FIELDS: readonly CanonicalField[] = [
  'title',
  'body',
  'subtasks',
  'completion',
  'Status',
  'label',
];

const MIRROR_BASELINES: Readonly<Record<string, string>> = {
  title: '',
  body: '',
  completion: 'false',
  label: '',
};

function connection(): ConnectionDataTransferObject {
  return new ConnectionDataTransferObject({
    slug: 'conformance',
    application: 'conformance',
    target: 'board-1',
  });
}

class FakeOrigin extends FakeVaultBase {
  note: string | null;
  failWrites = false;
  readonly applied: CanonicalFieldWrite[] = [];
  readonly trashed: string[] = [];
  readonly values = new Map<string, string | null>();

  constructor(note: string | null) {
    super();
    this.note = note;
  }

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return [connection()];
  }

  override async listEntities(): Promise<readonly string[]> {
    return [ENTITY];
  }

  override async observe(
    _handle: string,
    field: string,
  ): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.values.get(field) ?? null,
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    });
  }

  override async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  override async applyField(write: CanonicalFieldWrite): Promise<void> {
    if (this.failWrites) {
      throw new Error('origin write failed');
    }
    this.applied.push(write);
    this.note = `status: ${write.value}`;
  }

  override async trashNote(handle: string): Promise<void> {
    this.trashed.push(handle);
    this.note = null;
  }
}

function task(status: string): CanonicalTask {
  return new CanonicalTask({
    handle: HANDLE,
    entityId: ENTITY,
    title: '',
    body: '',
    status,
    completed: false,
    parent: null,
    labels: [],
  });
}

function memoryStorage() {
  let data: Record<string, unknown> = {};
  return {
    async load() {
      return data;
    },
    async save(next: unknown) {
      data = next as Record<string, unknown>;
    },
  };
}

async function setup(
  origin: FakeOrigin,
  mirror: ConformanceMirrorAdapter,
  statusBaseline: string | null,
): Promise<{ action: MirrorSyncAction; registry: SyncStateAdapter }> {
  const registry = new SyncStateAdapter(memoryStorage());
  await registry.setEntity({ id: ENTITY, notePath: ENTITY });
  await registry.setMirrorItem(PROJECT, 'conformance', HANDLE, {
    entityId: ENTITY,
  });
  for (const field of MERGED_FIELDS) {
    const value =
      field === 'Status' ? statusBaseline : (MIRROR_BASELINES[field] ?? null);
    if (value !== null) {
      await registry.writeBaseline(
        ENTITY,
        field,
        'mirror:conformance',
        new Baseline(value, false),
      );
    }
  }
  if (statusBaseline !== null) {
    await registry.writeBaseline(
      ENTITY,
      'Status',
      'origin',
      new Baseline(statusBaseline, false),
    );
  }
  const action = new MirrorSyncAction(origin, registry, {
    create: () => mirror,
  });
  return { action, registry };
}

function statusOf(
  records: Awaited<ReturnType<MirrorSyncAction['invoke']>>,
): Awaited<ReturnType<MirrorSyncAction['invoke']>>[number] {
  return records.find((record) => record.field === 'Status')!;
}

describe('MirrorSyncAction — the origin write (F02 NWM-3, NWM-17)', () => {
  it('writes a mirror-won value back to the origin and advances both baselines', async () => {
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(task('Review'));
    const origin = new FakeOrigin('status: Building');
    origin.values.set('Status', 'Building');
    const { action } = await setup(origin, mirror, 'Building');

    const record = statusOf(await action.invoke(PROJECT));

    expect(record.result.value).toBe('Review');
    expect(origin.applied).toHaveLength(1);
    expect(origin.applied[0]!.value).toBe('Review');
    expect(origin.note).toBe('status: Review');
    expect(record.advanced).toContain('origin');
    expect(record.advanced).toContain('mirror:conformance');
  });

  it('leaves the origin note untouched when the origin wins', async () => {
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(task('Building'));
    const origin = new FakeOrigin('status: Done');
    origin.values.set('Status', 'Done');
    const { action } = await setup(origin, mirror, 'Building');

    const record = statusOf(await action.invoke(PROJECT));

    expect(record.result.value).toBe('Done');
    expect(origin.applied).toHaveLength(0);
    expect(origin.note).toBe('status: Done');
    expect(record.advanced).toContain('origin');
  });

  it('trashes the origin note when a mirror reports the entity deleted (NWM-25)', async () => {
    const mirror = new ConformanceMirrorAdapter();
    const origin = new FakeOrigin('status: Building');
    origin.values.set('Status', 'Building');
    const { action } = await setup(origin, mirror, 'Building');

    const record = statusOf(await action.invoke(PROJECT));

    expect(record.result.outcome).toBe('delete');
    expect(origin.trashed).toEqual([ENTITY]);
    expect(origin.note).toBeNull();
    expect(record.advanced).toContain('origin');
    expect(record.advanced).toContain('mirror:conformance');
  });

  it("removes the mirror entity when the origin's note is deleted (NWM-25, NWM-27)", async () => {
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(task('Review'));
    const origin = new FakeOrigin(null);
    const { action } = await setup(origin, mirror, 'Building');

    const record = statusOf(await action.invoke(PROJECT));

    expect(record.result.outcome).toBe('delete');
    expect(mirror.currentTask(HANDLE)).toBeNull();
    expect(record.advanced).toContain('origin');
    expect(record.advanced).toContain('mirror:conformance');
  });

  it('advances no baseline when the origin write fails (NWM-17, NWM-22)', async () => {
    const mirror = new ConformanceMirrorAdapter();
    mirror.seed(task('Review'));
    const origin = new FakeOrigin('status: Building');
    origin.values.set('Status', 'Building');
    origin.failWrites = true;
    const { action } = await setup(origin, mirror, 'Building');

    const record = statusOf(await action.invoke(PROJECT));

    expect(record.advanced).not.toContain('origin');
    expect(record.failed).toContain('origin');
    expect(origin.note).toBe('status: Building');
  });
});
