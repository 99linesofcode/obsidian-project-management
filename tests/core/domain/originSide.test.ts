import { describe, expect, it } from 'vitest';
import type { CanonicalField } from '../../../src/core/domain/canonicalField.js';
import { Baseline } from '../../../src/core/domain/Baseline.js';
import { CanonicalFieldWrite } from '../../../src/core/port/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../../src/core/port/data/CanonicalTask.js';
import { MirrorSide } from '../../../src/core/application/data/MirrorSide.js';
import { MirrorSyncPass } from '../../../src/core/application/data/MirrorSyncPass.js';
import { OriginObservation } from '../../../src/core/domain/OriginObservation.js';
import type { MirrorPort } from '../../../src/core/port/MirrorPort.js';
import { SideObservation } from '../../../src/core/domain/SideObservation.js';
import { MirrorSyncAction } from '../../../src/core/application/actions/MirrorSyncAction.js';
import { originSideObservation } from '../../../src/core/domain/originSideObservation.js';
import { ConformanceMirrorAdapter } from '../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { FakeVault as FakeVaultBase } from '../../helpers/fakeVault.js';

class FakeOrigin extends FakeVaultBase {
  note: string | null;
  failWrites = false;
  readonly applied: CanonicalFieldWrite[] = [];
  readonly trashed: string[] = [];

  constructor(note: string | null) {
    super();
    this.note = note;
  }

  override async observe(
    _handle: string,
    _field: CanonicalField,
  ): Promise<{
    current: null;
    currentCompleted: boolean;
    fieldTime: null;
    trustworthy: boolean;
  }> {
    return {
      current: null,
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    };
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

function task(entityId: string, status: string): CanonicalTask {
  return new CanonicalTask({
    handle: entityId,
    entityId,
    title: 'Task',
    body: '',
    status,
    completed: false,
    parent: null,
    labels: [],
  });
}

function originSide(
  status: string | null,
  baseline: Baseline,
): SideObservation {
  return originSideObservation(
    'vault',
    baseline,
    new OriginObservation({
      current: status,
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    }),
  );
}

function mirrorAdapter(): ConformanceMirrorAdapter {
  return new ConformanceMirrorAdapter();
}

function side(name: string, adapter: MirrorPort): MirrorSide {
  return new MirrorSide({ side: name, handle: 't1', adapter });
}

describe('MirrorSyncAction — the origin write (F02 NWM-3, NWM-17)', () => {
  it('writes a mirror-won value back to the origin and advances both baselines', async () => {
    const adapter = mirrorAdapter();
    adapter.seed(task('t1', 'Review'));
    const origin = new FakeOrigin('status: Building');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Building', new Baseline('Building', false)),
      mirrors: [side('conformance', adapter)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.result.value).toBe('Review');
    expect(origin.applied).toHaveLength(1);
    expect(origin.applied[0]!.value).toBe('Review');
    expect(origin.note).toBe('status: Review');
    expect(record.advanced).toContain('vault');
    expect(record.advanced).toContain('conformance');
  });

  it('leaves the origin note untouched when the origin wins', async () => {
    const adapter = mirrorAdapter();
    adapter.seed(task('t1', 'Building'));
    const origin = new FakeOrigin('status: Done');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Done', new Baseline('Building', false)),
      mirrors: [side('conformance', adapter)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.result.value).toBe('Done');
    expect(origin.applied).toHaveLength(0);
    expect(origin.note).toBe('status: Done');
    expect(record.advanced).toContain('vault');
  });

  it('trashes the origin note when a mirror reports the entity deleted (NWM-25)', async () => {
    const adapter = mirrorAdapter();
    const origin = new FakeOrigin('status: Building');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Building', new Baseline('Building', false)),
      mirrors: [side('conformance', adapter)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.result.outcome).toBe('delete');
    expect(origin.trashed).toEqual(['t1']);
    expect(origin.note).toBeNull();
    expect(record.advanced).toContain('vault');
    expect(record.advanced).toContain('conformance');
  });

  it("removes the mirror entity when the origin's note is deleted (NWM-25, NWM-27)", async () => {
    const adapter = mirrorAdapter();
    adapter.seed(task('t1', 'Review'));
    const origin = new FakeOrigin(null);

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide(null, new Baseline('Building', false)),
      mirrors: [side('conformance', adapter)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.result.outcome).toBe('delete');
    expect(adapter.currentTask('t1')).toBeNull();
    expect(record.advanced).toContain('vault');
    expect(record.advanced).toContain('conformance');
  });

  it('advances no baseline when the origin write fails (NWM-17, NWM-22)', async () => {
    const adapter = mirrorAdapter();
    adapter.seed(task('t1', 'Review'));
    const origin = new FakeOrigin('status: Building');
    origin.failWrites = true;

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Building', new Baseline('Building', false)),
      mirrors: [side('conformance', adapter)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.advanced).not.toContain('vault');
    expect(record.failed).toContain('vault');
    expect(origin.note).toBe('status: Building');
  });
});
