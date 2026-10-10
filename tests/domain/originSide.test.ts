import { describe, expect, it } from 'vitest';
import type { CanonicalField } from '../../src/domain/canonicalField.js';
import { AdapterRegistration } from '../../src/domain/data/AdapterRegistration.js';
import { Baseline } from '../../src/domain/data/Baseline.js';
import { CanonicalFieldWrite } from '../../src/domain/data/CanonicalFieldWrite.js';
import { CanonicalTask } from '../../src/domain/data/CanonicalTask.js';
import { MirrorSide } from '../../src/domain/data/MirrorSide.js';
import { MirrorSyncPass } from '../../src/domain/data/MirrorSyncPass.js';
import { OriginObservation } from '../../src/domain/data/OriginObservation.js';
import type { RegisteredAdapter } from '../../src/domain/data/RegisteredAdapter.js';
import { SideObservation } from '../../src/domain/data/SideObservation.js';
import { MirrorSyncAction } from '../../src/domain/actions/MirrorSyncAction.js';
import { originSideObservation } from '../../src/domain/originSideObservation.js';
import { registerAdapters } from '../../src/domain/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';

class FakeOrigin {
  note: string | null;
  failWrites = false;
  readonly applied: CanonicalFieldWrite[] = [];
  readonly trashed: string[] = [];

  constructor(note: string | null) {
    this.note = note;
  }

  async observe(
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

  async readTask(): Promise<CanonicalTask | null> {
    return null;
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    if (this.failWrites) {
      throw new Error('origin write failed');
    }
    this.applied.push(write);
    this.note = `status: ${write.value}`;
  }

  async trash(handle: string): Promise<void> {
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

function mirrorAdapter(applicationId: string): {
  adapter: ConformanceMirrorAdapter;
  registered: RegisteredAdapter;
} {
  const adapter = new ConformanceMirrorAdapter();
  const result = registerAdapters([
    new AdapterRegistration(conformanceDescriptor(applicationId), adapter),
  ]);
  return { adapter, registered: result.adapters.get(applicationId)! };
}

function side(name: string, registered: RegisteredAdapter): MirrorSide {
  return new MirrorSide({ side: name, handle: 't1', adapter: registered });
}

describe('MirrorSyncAction — the origin write (F02 NWM-3, NWM-17)', () => {
  it('writes a mirror-won value back to the origin and advances both baselines', async () => {
    const { adapter, registered } = mirrorAdapter('conformance');
    adapter.seed(task('t1', 'Review'));
    const origin = new FakeOrigin('status: Building');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Building', new Baseline('Building', false)),
      mirrors: [side('conformance', registered)],
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
    const { adapter, registered } = mirrorAdapter('conformance');
    adapter.seed(task('t1', 'Building'));
    const origin = new FakeOrigin('status: Done');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Done', new Baseline('Building', false)),
      mirrors: [side('conformance', registered)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.result.value).toBe('Done');
    expect(origin.applied).toHaveLength(0);
    expect(origin.note).toBe('status: Done');
    expect(record.advanced).toContain('vault');
  });

  it('trashes the origin note when a mirror reports the entity deleted (NWM-25)', async () => {
    const { registered } = mirrorAdapter('conformance');
    const origin = new FakeOrigin('status: Building');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Building', new Baseline('Building', false)),
      mirrors: [side('conformance', registered)],
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
    const { adapter, registered } = mirrorAdapter('conformance');
    adapter.seed(task('t1', 'Review'));
    const origin = new FakeOrigin(null);

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide(null, new Baseline('Building', false)),
      mirrors: [side('conformance', registered)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.result.outcome).toBe('delete');
    expect(adapter.currentTask('t1')).toBeNull();
    expect(record.advanced).toContain('vault');
    expect(record.advanced).toContain('conformance');
  });

  it('advances no baseline when the origin write fails (NWM-17, NWM-22)', async () => {
    const { adapter, registered } = mirrorAdapter('conformance');
    adapter.seed(task('t1', 'Review'));
    const origin = new FakeOrigin('status: Building');
    origin.failWrites = true;

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: originSide('Building', new Baseline('Building', false)),
      mirrors: [side('conformance', registered)],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction(origin).invoke(pass);

    expect(record.advanced).not.toContain('vault');
    expect(record.failed).toContain('vault');
    expect(origin.note).toBe('status: Building');
  });
});
