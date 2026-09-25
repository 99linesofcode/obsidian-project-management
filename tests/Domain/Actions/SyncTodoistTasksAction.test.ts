import { describe, expect, it } from 'vitest';
import { SyncTodoistTasksAction } from '../../../src/Domain/Actions/SyncTodoistTasksAction.js';
import type { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import type { ProjectTasksToTodoistAction } from '../../../src/Domain/Actions/ProjectTasksToTodoistAction.js';
import type { ProjectToDosToTodoistAction } from '../../../src/Domain/Actions/ProjectToDosToTodoistAction.js';
import type { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';
import type { ReconcileTodoistProjectAction } from '../../../src/Domain/Actions/ReconcileTodoistProjectAction.js';

// A fake lifecycle that records its call and can freeze (return null) or fail.
class FakeReconcileTodoist {
  calls: Array<{
    projectName: string;
    notePath: string;
    locationArchived: boolean;
    syncedAt: string;
  }> = [];
  frozen = false;
  fail = false;

  async execute(input: {
    projectName: string;
    notePath: string;
    locationArchived: boolean;
    syncedAt: string;
  }): Promise<string | null> {
    this.calls.push(input);
    if (this.fail) {
      throw new Error('todoist failed');
    }
    return this.frozen ? null : 'P1';
  }
}

// A recording step that pushes its name into the shared events array.
function recorder(events: string[], name: string) {
  return {
    execute: async () => {
      events.push(name);
    },
  };
}

function harness() {
  const events: string[] = [];
  const reconcileTodoist = new FakeReconcileTodoist();
  const action = new SyncTodoistTasksAction(
    reconcileTodoist as unknown as ReconcileTodoistProjectAction,
    recorder(
      events,
      'applyRemoteChanges',
    ) as unknown as ApplyTodoistRemoteChangesAction,
    recorder(
      events,
      'captureCreations',
    ) as unknown as CaptureTodoistCreationsAction,
    recorder(events, 'projectTasks') as unknown as ProjectTasksToTodoistAction,
    recorder(
      events,
      'applyCompletion',
    ) as unknown as ApplyTodoistCompletionAction,
    recorder(events, 'projectToDos') as unknown as ProjectToDosToTodoistAction,
    recorder(
      events,
      'propagateDeletions',
    ) as unknown as PropagateTodoistDeletionsAction,
  );
  return { action, events, reconcileTodoist };
}

const input = {
  projectName: 'Acme Widgets',
  notePath: 'Projecten/Acme Widgets/_home.md',
  locationArchived: false,
  syncedAt: '2026-09-18T12:00:00Z',
};

describe('SyncTodoistTasksAction', () => {
  it('absorbs remote changes before projecting, deletions last', async () => {
    // Given — an active project whose lifecycle resolves a project id
    const h = harness();

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the steps run in the apply-before-project order, deletions last
    expect(h.events).toEqual([
      'applyRemoteChanges',
      'captureCreations',
      'projectTasks',
      'applyCompletion',
      'projectToDos',
      'propagateDeletions',
    ]);
  });

  it('skips every step when the project is frozen-archived', async () => {
    // Given — a lifecycle that returns null (frozen)
    const h = harness();
    h.reconcileTodoist.frozen = true;

    // When — the Todoist half runs
    await h.action.execute(input);

    // Then — the freeze gates the whole half off
    expect(h.reconcileTodoist.calls).toHaveLength(1);
    expect(h.events).toEqual([]);
  });

  it('swallows a lifecycle failure so the GitHub half is never affected', async () => {
    // Given — a lifecycle that throws
    const h = harness();
    h.reconcileTodoist.fail = true;

    // When — the Todoist half runs
    await expect(h.action.execute(input)).resolves.toBeUndefined();

    // Then — no step ran and the failure did not propagate
    expect(h.events).toEqual([]);
  });
});
