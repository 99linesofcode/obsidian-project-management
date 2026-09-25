import { describe, expect, it } from 'vitest';
import { SyncTodoistTasksAction } from '../../../src/Domain/Actions/SyncTodoistTasksAction.js';
import type { ApplyTodoistCompletionAction } from '../../../src/Domain/Actions/ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from '../../../src/Domain/Actions/ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from '../../../src/Domain/Actions/CaptureTodoistCreationsAction.js';
import type { ProjectTasksToTodoistAction } from '../../../src/Domain/Actions/ProjectTasksToTodoistAction.js';
import type { ProjectToDosToTodoistAction } from '../../../src/Domain/Actions/ProjectToDosToTodoistAction.js';
import type { PropagateTodoistDeletionsAction } from '../../../src/Domain/Actions/PropagateTodoistDeletionsAction.js';

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
  const action = new SyncTodoistTasksAction(
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
  return { action, events };
}

const input = {
  projectName: 'Acme Widgets',
  projectId: 'P1',
  syncedAt: '2026-09-18T12:00:00Z',
};

describe('SyncTodoistTasksAction', () => {
  it('absorbs remote changes before projecting, deletions last', async () => {
    // Given — an active project whose lifecycle already resolved a project id
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

  it('swallows a step failure so the GitHub half is never affected', async () => {
    // Given — a first step that throws
    const events: string[] = [];
    const action = new SyncTodoistTasksAction(
      {
        execute: async () => {
          throw new Error('todoist failed');
        },
      } as unknown as ApplyTodoistRemoteChangesAction,
      recorder(
        events,
        'captureCreations',
      ) as unknown as CaptureTodoistCreationsAction,
      recorder(
        events,
        'projectTasks',
      ) as unknown as ProjectTasksToTodoistAction,
      recorder(
        events,
        'applyCompletion',
      ) as unknown as ApplyTodoistCompletionAction,
      recorder(
        events,
        'projectToDos',
      ) as unknown as ProjectToDosToTodoistAction,
      recorder(
        events,
        'propagateDeletions',
      ) as unknown as PropagateTodoistDeletionsAction,
    );

    // When — the Todoist half runs
    await expect(action.execute(input)).resolves.toBeUndefined();

    // Then — no later step ran and the failure did not propagate
    expect(events).toEqual([]);
  });
});
