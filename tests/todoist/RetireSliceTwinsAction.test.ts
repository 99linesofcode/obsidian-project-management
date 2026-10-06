import { describe, expect, it } from 'vitest';
import { RetireSliceTwinsAction } from '../../src/todoist/RetireSliceTwinsAction.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';
import { todoistTask } from '../helpers/records.js';
import type { TaskManagerPort } from '../../src/shared/TaskManagerPort.js';

function harness() {
  const syncState = new FakeSyncState();
  const moves: Array<{ id: string; parentId: string | null }> = [];
  const deleted: string[] = [];
  let failMove = false;
  const taskManager = {
    async moveTask(id: string, placement: { parentId: string | null }) {
      if (failMove) {
        throw new Error('flatten failed');
      }
      moves.push({ id, parentId: placement.parentId });
    },
    async deleteTask(id: string) {
      deleted.push(id);
    },
  } as unknown as TaskManagerPort;
  const action = new RetireSliceTwinsAction(taskManager, syncState);
  return {
    action,
    syncState,
    moves,
    deleted,
    failNextMove: () => {
      failMove = true;
    },
    allowMove: () => {
      failMove = false;
    },
  };
}

describe('SLI-2 — a slice twin is retired only after its children are flattened', () => {
  it('flattens a slice twin’s children before deleting it', async () => {
    const h = harness();
    h.syncState.seed(
      { id: 'entity-slice', notePath: 'Projecten/Acme Widgets/taken/slice.md' },
      { todoist: { handle: 'SLICE', base: null } },
    );

    await h.action.execute({
      projectName: 'Acme Widgets',
      sliceHandles: ['SLICE'],
      active: [
        todoistTask({ id: 'child-1', parentId: 'SLICE' }),
        todoistTask({ id: 'child-2', parentId: 'SLICE' }),
      ],
    });

    expect(h.moves).toEqual([
      { id: 'child-1', parentId: null },
      { id: 'child-2', parentId: null },
    ]);
    expect(h.deleted).toEqual(['SLICE']);
    expect(h.syncState.handleOf('entity-slice', 'todoist')).toBeNull();
  });

  it('deletes a childless slice twin without a move', async () => {
    const h = harness();

    await h.action.execute({
      projectName: 'Acme Widgets',
      sliceHandles: ['SLICE'],
      active: [],
    });

    expect(h.moves).toEqual([]);
    expect(h.deleted).toEqual(['SLICE']);
  });
});

describe('SLI-3 — a failed flatten retries safely, losing no child', () => {
  it('aborts before the delete and completes the retirement on the next pass', async () => {
    const h = harness();
    h.syncState.seed(
      { id: 'entity-slice', notePath: 'Projecten/Acme Widgets/taken/slice.md' },
      { todoist: { handle: 'SLICE', base: null } },
    );
    const active = [todoistTask({ id: 'child-1', parentId: 'SLICE' })];
    h.failNextMove();

    await expect(
      h.action.execute({
        projectName: 'Acme Widgets',
        sliceHandles: ['SLICE'],
        active,
      }),
    ).rejects.toThrow('flatten failed');

    expect(h.deleted).toEqual([]);
    expect(h.syncState.handleOf('entity-slice', 'todoist')).toBe('SLICE');

    h.allowMove();
    await h.action.execute({
      projectName: 'Acme Widgets',
      sliceHandles: ['SLICE'],
      active,
    });

    expect(h.moves).toEqual([{ id: 'child-1', parentId: null }]);
    expect(h.deleted).toEqual(['SLICE']);
    expect(h.syncState.handleOf('entity-slice', 'todoist')).toBeNull();
  });
});
