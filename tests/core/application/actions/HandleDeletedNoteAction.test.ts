import { describe, expect, it } from 'vitest';
import { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { CanonicalFieldWrite } from '../../../../src/core/application/data/CanonicalFieldWrite.js';
import type { RegisteredAdapter } from '../../../../src/core/application/data/RegisteredAdapter.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import type { TaskSurfacePort } from '../../../../src/core/port/TaskSurfacePort.js';
import { entityRecord, taskData } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

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
const todoistTarget = 'P1';

function seed(syncState: FakeSyncState, lane = 'Building'): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: {
      handle: url,
      base: taskData({ id: 'uuid-42', notePath, status: lane }),
    },
  });
}

function seedBoth(syncState: FakeSyncState, lane = 'Building'): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: {
      handle: url,
      base: taskData({ id: 'uuid-42', notePath, status: lane }),
    },
    todoist: {
      handle: 'T1',
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
      connections: [{ slug: 'github', application, target }],
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
      connections: [{ slug: 'github', application, target }],
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
      connections: [{ slug: 'github', application, target }],
    });

    expect(mirrorAdapters.tasks.deleted).toEqual([]);
    expect(mirrorAdapters.tasks.writes).toEqual([]);
    expect(syncState.removed).toEqual([]);
  });
});

describe('SHELL-3 — every connection mirror is deleted before the record is dropped', () => {
  const orders = [
    ['todoist', 'github'],
    ['github', 'todoist'],
  ] as const;

  for (const order of orders) {
    it(`deletes both mirrors for connections ordered {${order.join(', ')}}`, async () => {
      const mirrorAdapters = new FakeMirrorAdapters();
      const syncState = new FakeSyncState();
      seedBoth(syncState);
      const action = makeAction(syncState, mirrorAdapters);
      const bySlug = {
        github: { slug: 'github', application, target },
        todoist: {
          slug: 'todoist',
          application: 'todoist',
          target: todoistTarget,
        },
      };

      await action.execute({
        notePath,
        projectName,
        connections: order.map((slug) => bySlug[slug]),
      });

      expect(mirrorAdapters.tasks.deleted.sort()).toEqual([url, 'T1'].sort());
      expect(mirrorAdapters.tasks.writes).toHaveLength(2);
      expect(syncState.removed).toEqual(['uuid-42']);
      expect(await syncState.findByNotePath(notePath)).toBeNull();
    });
  }
});
