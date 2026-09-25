import type { ApplyTodoistCompletionAction } from './ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from './ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from './CaptureTodoistCreationsAction.js';
import type { ProjectTasksToTodoistAction } from './ProjectTasksToTodoistAction.js';
import type { ProjectToDosToTodoistAction } from './ProjectToDosToTodoistAction.js';
import type { PropagateTodoistDeletionsAction } from './PropagateTodoistDeletionsAction.js';
import type { ReconcileTodoistProjectAction } from './ReconcileTodoistProjectAction.js';

export interface SyncTodoistTasksInput {
  projectName: string;
  notePath: string;
  locationArchived: boolean;
  syncedAt: string;
}

// The Todoist half of the chain: mirror the project's lifecycle, then absorb
// the remote side into the vault, then project the vault's tasks and their
// to-dos. The lifecycle action returns the project id when the project is
// active and null when it is frozen-archived, so the freeze gates the whole
// reconcile too (dt-10). Remote absorption comes first (t5): the snapshot
// verdicts and captured creations land in the vault before any projection
// pushes, so a remote change is never clobbered by a vault-side push — the
// same apply-before-project invariant t4 established for completions. The
// to-do completion pull then runs before the to-do projection for the same
// reason. Deletion propagation closes the half (spec step 7): twins whose
// notes are gone are removed after the projections, and the action deletes
// each twin before evicting its record, so a deleted note's twin never
// lingers into the next tick's capture pass. A failure is swallowed so the
// GitHub half's outcome is never affected; the next tick retries.
//
// t2 interim: this is the old SyncScheduler.runTodoistHalf body, extracted
// verbatim so the rewritten SyncProjectAction can compose it as the chain's
// Todoist half. t4 rebuilds it on the canonical pipeline.
export class SyncTodoistTasksAction {
  constructor(
    private readonly reconcileTodoistProject: ReconcileTodoistProjectAction,
    private readonly applyTodoistRemoteChanges: ApplyTodoistRemoteChangesAction,
    private readonly captureTodoistCreations: CaptureTodoistCreationsAction,
    private readonly projectTasksToTodoist: ProjectTasksToTodoistAction,
    private readonly applyTodoistCompletion: ApplyTodoistCompletionAction,
    private readonly projectToDosToTodoist: ProjectToDosToTodoistAction,
    private readonly propagateTodoistDeletions: PropagateTodoistDeletionsAction,
  ) {}

  async execute(input: SyncTodoistTasksInput): Promise<void> {
    try {
      const projectId = await this.reconcileTodoistProject.execute({
        projectName: input.projectName,
        notePath: input.notePath,
        locationArchived: input.locationArchived,
        syncedAt: input.syncedAt,
      });
      if (projectId === null) {
        return;
      }
      await this.applyTodoistRemoteChanges.execute({
        projectName: input.projectName,
        projectId,
        syncedAt: input.syncedAt,
      });
      await this.captureTodoistCreations.execute({
        projectName: input.projectName,
        projectId,
        syncedAt: input.syncedAt,
      });
      await this.projectTasksToTodoist.execute({
        projectName: input.projectName,
        projectId,
        syncedAt: input.syncedAt,
      });
      await this.applyTodoistCompletion.execute({
        projectName: input.projectName,
        projectId,
        syncedAt: input.syncedAt,
      });
      await this.projectToDosToTodoist.execute({
        projectName: input.projectName,
        projectId,
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
