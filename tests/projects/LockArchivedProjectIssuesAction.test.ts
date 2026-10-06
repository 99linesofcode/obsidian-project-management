import { describe, expect, it } from 'vitest';
import { LockArchivedProjectIssuesAction } from '../../src/projects/LockArchivedProjectIssuesAction.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';
import { taskData } from '../helpers/records.js';
import type { ProjectManagementPort } from '../../src/github/ProjectManagementPort.js';

function harness() {
  const syncState = new FakeSyncState();
  const lockedNodeIds: string[] = [];
  const tasks = new Map<string, { nodeId: string }>([
    ['https://github.com/acme/widgets/issues/42', { nodeId: 'I_42' }],
  ]);
  const port = {
    async fetchTask(handle: string) {
      return tasks.get(handle)!;
    },
    async lockIssue(nodeId: string) {
      lockedNodeIds.push(nodeId);
    },
  } as unknown as ProjectManagementPort;
  const action = new LockArchivedProjectIssuesAction(
    syncState,
    port,
    'Done',
  );
  return { action, syncState, lockedNodeIds };
}

describe('LockArchivedProjectIssuesAction', () => {
  it('locks an unshipped issue', async () => {
    const h = harness();
    h.syncState.seed(
      { id: 'entity-1', notePath: 'Projecten/Acme Widgets/taken/42.md' },
      {
        github: {
          handle: 'https://github.com/acme/widgets/issues/42',
          base: taskData({ status: 'Building' }),
        },
      },
    );

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.lockedNodeIds).toEqual(['I_42']);
  });

  it('skips an issue already in the done lane', async () => {
    const h = harness();
    h.syncState.seed(
      { id: 'entity-1', notePath: 'Projecten/Acme Widgets/taken/42.md' },
      {
        github: {
          handle: 'https://github.com/acme/widgets/issues/42',
          base: taskData({ status: 'Done' }),
        },
      },
    );

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.lockedNodeIds).toEqual([]);
  });

  it('skips an entity with no github mirror item', async () => {
    const h = harness();
    h.syncState.seed({
      id: 'entity-1',
      notePath: 'Projecten/Acme Widgets/todos/42.md',
    });

    await h.action.execute({ projectName: 'Acme Widgets' });

    expect(h.lockedNodeIds).toEqual([]);
  });
});
