import { describe, expect, it } from 'vitest';
import { HandleDeletedNoteAction } from '../../src/sync/HandleDeletedNoteAction.js';
import { CanonicalFieldWrite } from '../../src/core/data/CanonicalFieldWrite.js';
import type { RegisteredAdapter } from '../../src/core/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../src/core/ports/MirrorAdapterFactoryPort.js';
import type { TaskSurfacePort } from '../../src/core/ports/TaskSurfacePort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

class FakeTaskSurface implements TaskSurfacePort {
  deleted: string[] = [];
  writes: CanonicalFieldWrite[] = [];

  async readTasks(): Promise<never> {
    throw new Error('not used in this test');
  }
  async readTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async createTask(): Promise<never> {
    throw new Error('not used in this test');
  }
  async applyField(write: CanonicalFieldWrite): Promise<void> {
    this.writes.push(write);
  }
  async deleteTask(handle: string): Promise<void> {
    this.deleted.push(handle);
  }
}

class FakeMirrorAdapters implements MirrorAdapterFactoryPort {
  readonly tasks = new FakeTaskSurface();

  create(): RegisteredAdapter {
    return { tasks: this.tasks } as unknown as RegisteredAdapter;
  }
}

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const projectName = 'Acme Widgets';
const application = 'github';
const target = 'https://github.com/acme/widgets';

function seed(syncState: FakeSyncState, lane = 'Building'): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: {
      handle: url,
      base: taskData({ id: 'uuid-42', notePath, status: lane }),
    },
  });
}

function makeAction(
  syncState: FakeSyncState,
  mirrorAdapters: FakeMirrorAdapters,
) {
  return new HandleDeletedNoteAction(syncState, mirrorAdapters, 'Shipped');
}

describe('DEL-1 — a deleted note closes its issue and drops its record', () => {
  it('deletes the card, closes the issue and removes the record', async () => {
    const mirrorAdapters = new FakeMirrorAdapters();
    const syncState = new FakeSyncState();
    seed(syncState);
    const action = makeAction(syncState, mirrorAdapters);

    await action.execute({
      notePath,
      projectName,
      connectionSlug: 'github',
      application,
      target,
    });

    expect(mirrorAdapters.tasks.deleted).toEqual([url]);
    expect(mirrorAdapters.tasks.writes).toEqual([
      { handle: url, field: 'completion', value: 'true' },
    ]);
    expect(syncState.removed).toEqual(['uuid-42']);
    expect(await syncState.findByNotePath(notePath)).toBeNull();
  });

  it('skips the close when the record already sits in the done lane', async () => {
    const mirrorAdapters = new FakeMirrorAdapters();
    const syncState = new FakeSyncState();
    seed(syncState, 'Shipped');
    const action = makeAction(syncState, mirrorAdapters);

    await action.execute({
      notePath,
      projectName,
      connectionSlug: 'github',
      application,
      target,
    });

    expect(mirrorAdapters.tasks.deleted).toEqual([url]);
    expect(mirrorAdapters.tasks.writes).toEqual([]);
    expect(syncState.removed).toEqual(['uuid-42']);
  });

  it('does nothing for an untracked note', async () => {
    const mirrorAdapters = new FakeMirrorAdapters();
    const syncState = new FakeSyncState();
    const action = makeAction(syncState, mirrorAdapters);

    await action.execute({
      notePath: 'Projecten/Acme Widgets/taken/99-untracked.md',
      projectName,
      connectionSlug: 'github',
      application,
      target,
    });

    expect(mirrorAdapters.tasks.deleted).toEqual([]);
    expect(mirrorAdapters.tasks.writes).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });
});
