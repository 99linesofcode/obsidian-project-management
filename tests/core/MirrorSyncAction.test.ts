import { describe, expect, it } from 'vitest';
import { AdapterRegistration } from '../../src/core/data/AdapterRegistration.js';
import { Baseline } from '../../src/core/data/Baseline.js';
import { CanonicalTask } from '../../src/core/data/CanonicalTask.js';
import { MirrorSyncPass } from '../../src/core/data/MirrorSyncPass.js';
import type { RegisteredAdapter } from '../../src/core/data/RegisteredAdapter.js';
import { SideObservation } from '../../src/core/data/SideObservation.js';
import { MirrorSyncAction } from '../../src/core/MirrorSyncAction.js';
import { registerAdapters } from '../../src/core/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';

function task(
  entityId: string,
  status: string,
  completed = false,
): CanonicalTask {
  return new CanonicalTask({
    handle: entityId,
    entityId,
    title: 'Task',
    body: '',
    status,
    completed,
    parent: null,
    labels: [],
  });
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

function vaultOrigin(
  status: string,
  baseline: Baseline,
  completed = false,
): SideObservation {
  return new SideObservation({
    side: 'vault',
    role: 'origin',
    current: status,
    baseline,
    fieldTime: null,
    timestampTrustworthy: true,
    completeFetch: true,
    currentCompleted: completed,
  });
}

describe('MirrorSyncAction — the Status field end to end (F02 NWM-2, NWM-3)', () => {
  it('fans a lone vault Status change out to the mirror at N=2', async () => {
    const { adapter, registered } = mirrorAdapter('conformance');
    adapter.seed(task('t1', 'Building'));

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: vaultOrigin('Done', new Baseline('Building', false), true),
      mirrors: [registered],
      baselines: new Map([['conformance', new Baseline('Building', false)]]),
    });

    const record = await new MirrorSyncAction().invoke(pass);

    expect(record.result.value).toBe('Done');
    expect(record.written).toEqual(['conformance']);
    expect(adapter.currentTask('t1')?.status).toBe('Done');
  });
});

describe('MirrorSyncAction — the Status field at N=3 (F02 NWM-1, NWM-6)', () => {
  it('writes the provably-newest mirror delta to every capable mirror', async () => {
    const alpha = mirrorAdapter('alpha');
    const beta = mirrorAdapter('beta');
    const gamma = mirrorAdapter('gamma');
    alpha.adapter.seed(task('t1', 'Review'));
    beta.adapter.seed(task('t1', 'Todo'));
    gamma.adapter.seed(task('t1', 'Building'));
    alpha.adapter.setFieldTime('t1', 'Status', '2026-10-08T11:00:00Z');
    beta.adapter.setFieldTime('t1', 'Status', '2026-10-08T10:00:00Z');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: vaultOrigin('Building', new Baseline('Building', false)),
      mirrors: [alpha.registered, beta.registered, gamma.registered],
      baselines: new Map([
        ['alpha', new Baseline('Building', false)],
        ['beta', new Baseline('Building', false)],
        ['gamma', new Baseline('Building', false)],
      ]),
    });

    const record = await new MirrorSyncAction().invoke(pass);

    expect(record.result.rung).toBe(1);
    expect(record.result.winner).toBe('alpha');
    expect(alpha.adapter.currentTask('t1')?.status).toBe('Review');
    expect(beta.adapter.currentTask('t1')?.status).toBe('Review');
    expect(gamma.adapter.currentTask('t1')?.status).toBe('Review');
  });
});
