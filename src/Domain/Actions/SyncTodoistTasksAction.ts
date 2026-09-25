import type { ApplyTodoistCompletionAction } from './ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from './ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from './CaptureTodoistCreationsAction.js';
import type { ProjectTasksToTodoistAction } from './ProjectTasksToTodoistAction.js';
import type { ProjectToDosToTodoistAction } from './ProjectToDosToTodoistAction.js';
import type { PropagateTodoistDeletionsAction } from './PropagateTodoistDeletionsAction.js';

export interface SyncTodoistTasksInput {
  projectName: string;
  // The resolved Todoist project id from the chain's lifecycle verdict. The
  // lifecycle (freeze verdict, project resolution) runs as chain step 2, so
  // this half only mirrors an already-active project.
  projectId: string;
  syncedAt: string;
}

// The Todoist half of the chain. The lifecycle step (step 2) has already
// resolved the project and decided the freeze verdict, so this half runs only
// for an active project. It absorbs the remote side into the vault, captures
// Todoist-created items, projects the vault's tasks and to-dos, and propagates
// deletions last (spec reconcile step 7). Remote absorption comes first: the
// snapshot verdicts and captured creations land in the vault before any
// projection pushes, so a remote change is never clobbered by a vault-side
// push. A failure is swallowed so the GitHub half's outcome is never affected;
// the next tick retries.
export class SyncTodoistTasksAction {
  constructor(
    private readonly applyTodoistRemoteChanges: ApplyTodoistRemoteChangesAction,
    private readonly captureTodoistCreations: CaptureTodoistCreationsAction,
    private readonly projectTasksToTodoist: ProjectTasksToTodoistAction,
    private readonly applyTodoistCompletion: ApplyTodoistCompletionAction,
    private readonly projectToDosToTodoist: ProjectToDosToTodoistAction,
    private readonly propagateTodoistDeletions: PropagateTodoistDeletionsAction,
  ) {}

  async execute(input: SyncTodoistTasksInput): Promise<void> {
    try {
      await this.applyTodoistRemoteChanges.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.captureTodoistCreations.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.projectTasksToTodoist.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.applyTodoistCompletion.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.projectToDosToTodoist.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      // Deletion propagation runs last (spec reconcile step 7): the vault-side
      // projections have already pushed their state, and the twin-then-record
      // ordering inside the action keeps an evicted anchor from resurrecting.
      await this.propagateTodoistDeletions.execute({
        projectName: input.projectName,
      });
    } catch {
      // A Todoist failure must never break the GitHub half.
    }
  }
}
