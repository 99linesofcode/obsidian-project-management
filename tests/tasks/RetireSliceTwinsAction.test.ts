import { describe, expect, it } from 'vitest';
import { RetireSliceTwinsAction } from '../../src/tasks/RetireSliceTwinsAction.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';
import { todoistTask } from '../helpers/records.js';
import type { TaskManagerPort } from '../../src/todoist/TaskManagerPort.js';

function harness() {
  const syncState = new FakeSyncState();
  const moves: Array<{ id: string; parentId: string | null }> = [];
  const deleted: string[] = [];
  const taskManager = {
    async moveTask(id: string, placement: { parentId: string | null }) {
      moves.push({ id, parentId: placement.parentId });
    },
    async deleteTask(id: string) {
      deleted.push(id);
    },
  } as unknown as TaskManagerPort;
  const action = new RetireSliceTwinsAction(taskManager, syncState);
  return { action, syncState, moves, deleted };
}

describe('RetireSliceTwinsAction', () => {
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
