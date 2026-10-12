import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../../src/core/domain/Baseline.js';
import { CanonicalTask } from '../../../../src/core/port/data/CanonicalTask.js';
import { MirrorSide } from '../../../../src/core/application/data/MirrorSide.js';
import { MirrorSyncPass } from '../../../../src/core/application/data/MirrorSyncPass.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import { SideObservation } from '../../../../src/core/domain/SideObservation.js';
import { MirrorSyncAction } from '../../../../src/core/application/actions/MirrorSyncAction.js';
import { originSideObservation } from '../../../../src/core/domain/originSideObservation.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';

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

function mirrorAdapter(): ConformanceMirrorAdapter {
  return new ConformanceMirrorAdapter();
}

class FailingMirrorAdapter extends ConformanceMirrorAdapter {
  override async applyField(): Promise<void> {
    throw new Error('mirror write failed');
  }
}

function side(name: string, adapter: MirrorPort): MirrorSide {
  return new MirrorSide({ side: name, handle: 't1', adapter });
}

function vaultOrigin(
  status: string,
  baseline: Baseline,
  completed = false,
): SideObservation {
  return originSideObservation(
    'vault',
    baseline,
    new OriginObservation({
      current: status,
      currentCompleted: completed,
      fieldTime: null,
      trustworthy: true,
    }),
  );
}

describe('MirrorSyncAction — the Status field end to end (F02 NWM-2, NWM-3)', () => {
  it('fans a lone vault Status change out to the mirror at N=2', async () => {
    const adapter = mirrorAdapter();
    adapter.seed(task('t1', 'Building'));

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: vaultOrigin('Done', new Baseline('Building', false), true),
      mirrors: [side('conformance', adapter)],
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
    const alpha = mirrorAdapter();
    const beta = mirrorAdapter();
    const gamma = mirrorAdapter();
    alpha.seed(task('t1', 'Review'));
    beta.seed(task('t1', 'Todo'));
    gamma.seed(task('t1', 'Building'));
    alpha.setFieldTime('t1', 'Status', '2026-10-08T11:00:00Z');
    beta.setFieldTime('t1', 'Status', '2026-10-08T10:00:00Z');

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: vaultOrigin('Building', new Baseline('Building', false)),
      mirrors: [side('alpha', alpha), side('beta', beta), side('gamma', gamma)],
      baselines: new Map([
        ['alpha', new Baseline('Building', false)],
        ['beta', new Baseline('Building', false)],
        ['gamma', new Baseline('Building', false)],
      ]),
    });

    const record = await new MirrorSyncAction().invoke(pass);

    expect(record.result.rung).toBe(1);
    expect(record.result.winner).toBe('alpha');
    expect(alpha.currentTask('t1')?.status).toBe('Review');
    expect(beta.currentTask('t1')?.status).toBe('Review');
    expect(gamma.currentTask('t1')?.status).toBe('Review');
  });
});

describe('MirrorSyncAction — a failed mirror write (F02)', () => {
  it('records the failed side and keeps fanning out to the rest', async () => {
    const boom = new FailingMirrorAdapter();
    const alpha = mirrorAdapter();
    boom.seed(task('t1', 'Building'));
    alpha.seed(task('t1', 'Building'));

    const pass = new MirrorSyncPass({
      entityId: 't1',
      field: 'Status',
      origin: vaultOrigin('Done', new Baseline('Building', false), true),
      mirrors: [side('boom', boom), side('alpha', alpha)],
      baselines: new Map([
        ['boom', new Baseline('Building', false)],
        ['alpha', new Baseline('Building', false)],
      ]),
    });

    const record = await new MirrorSyncAction().invoke(pass);

    expect(record.failed).toEqual(['boom']);
    expect(record.written).toEqual(['alpha']);
    expect(record.advanced).toEqual(['alpha']);
    expect(alpha.currentTask('t1')?.status).toBe('Done');
  });
});
