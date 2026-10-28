import { describe, expect, it } from 'vitest';
import { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { CanonicalFieldWrite } from '../../../../src/core/port/data/CanonicalFieldWrite.js';
import type { MirrorPort } from '../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { entityRecord } from '../../../helpers/records.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

class FakeTaskSurface {
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

  create(): MirrorPort {
    return this.tasks as unknown as MirrorPort;
  }
}

const url = 'https://github.com/acme/widgets/issues/42';
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const projectName = 'Acme Widgets';
const application = 'github';
const target = 'https://github.com/acme/widgets';
const todoistTarget = 'P1';

function seed(syncState: FakeSyncState): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: { handle: url },
  });
}

function seedBoth(syncState: FakeSyncState): void {
  syncState.seed(entityRecord({ id: 'uuid-42', notePath }), {
    github: { handle: url },
    todoist: { handle: 'T1' },
  });
}

function makeAction(
  syncState: FakeSyncState,
  mirrorAdapters: FakeMirrorAdapters,
) {
  return new HandleDeletedNoteAction(syncState, mirrorAdapters);
}

describe('DEL-1 — a deleted vault note is a tracked change', () => {
  it('records a tombstone for the gone note', async () => {
    const mirrorAdapters = new FakeMirrorAdapters();
    const syncState = new FakeSyncState();
    seed(syncState);
    const action = makeAction(syncState, mirrorAdapters);

    await action.execute({
      notePath,
      projectId: projectName,
      projectName,
      connections: [{ slug: 'github', application, target }],
    });

    expect(await syncState.findTombstone(url)).toMatchObject({
      entityId: 'uuid-42',
      notePath,
    });
  });

  it('keeps the registry record until every side has settled', async () => {
    const mirrorAdapters = new FakeMirrorAdapters();
    const syncState = new FakeSyncState();
    seed(syncState);
    const action = makeAction(syncState, mirrorAdapters);

    await action.execute({
      notePath,
      projectId: projectName,
      projectName,
      connections: [{ slug: 'github', application, target }],
    });

    expect(await syncState.findByNotePath(notePath)).not.toBeNull();
  });

  it("deletes the code host's card, closes its issue, and deletes the task manager's task", async () => {
    const mirrorAdapters = new FakeMirrorAdapters();
    const syncState = new FakeSyncState();
    seedBoth(syncState);
    const action = makeAction(syncState, mirrorAdapters);

    await action.execute({
      notePath,
      projectId: projectName,
      projectName,
      connections: [
        { slug: 'github', application, target },
        { slug: 'todoist', application: 'todoist', target: todoistTarget },
      ],
    });

    expect(mirrorAdapters.tasks.deleted.sort()).toEqual([url, 'T1'].sort());
    expect(mirrorAdapters.tasks.writes).toContainEqual({
      handle: url,
      field: 'completion',
      value: 'true',
    });
  });

  it('does nothing for an untracked note', async () => {
    const mirrorAdapters = new FakeMirrorAdapters();
    const syncState = new FakeSyncState();
    const action = makeAction(syncState, mirrorAdapters);

    await action.execute({
      notePath: 'Projecten/Acme Widgets/taken/99-untracked.md',
      projectId: projectName,
      projectName,
      connections: [{ slug: 'github', application, target }],
    });

    expect(mirrorAdapters.tasks.deleted).toEqual([]);
    expect(mirrorAdapters.tasks.writes).toEqual([]);
    expect(syncState.tombstones.size).toBe(0);
  });
});

describe('SHELL-3 — every connection mirror is deleted before the record is pruned', () => {
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
        projectId: projectName,
        projectName,
        connections: order.map((slug) => bySlug[slug]),
      });

      expect(mirrorAdapters.tasks.deleted.sort()).toEqual([url, 'T1'].sort());
      expect(await syncState.findByNotePath(notePath)).not.toBeNull();
    });
  }
});
