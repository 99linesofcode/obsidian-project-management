import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { ReconcileArchiveStateAction } from './ReconcileArchiveStateAction.js';

export interface WatchArchivedProjectInput {
  projectName: string;
  syncedAt: string;
}

// UC: an archived project is frozen, but its repository is watched. A cheap
// conditional request (ETag) asks whether the repo's newest issue changed; a
// 304 costs nothing against the rate limit. The first watch adopts the current
// newest issue as the cursor, so issues predating the watch don't re-activate
// the project. A newer issue re-activates the project — folder back, board
// reopened, sync resumes — and clears the watch state; the next tick's full
// reconcile materializes the new issue. A failed re-activation throws before
// the watch state is cleared, so the next tick retries.
export class WatchArchivedProjectAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly reconcileArchiveState: ReconcileArchiveStateAction,
  ) {}

  async execute(input: WatchArchivedProjectInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity?.repoUrl) {
      return;
    }

    const watch = await this.syncState.getWatchState(input.projectName);
    const activity = await this.projectManagement.fetchLatestIssueActivity(
      identity.repoUrl,
      watch.etag ?? undefined,
    );
    if (!activity.changed) {
      return;
    }

    if (watch.cursor === null) {
      await this.syncState.setWatchState(input.projectName, {
        etag: activity.etag,
        cursor: activity.newestCreatedAt,
      });
      return;
    }

    if (
      activity.newestCreatedAt !== null &&
      activity.newestCreatedAt > watch.cursor
    ) {
      await this.reconcileArchiveState.reactivate(input.projectName);
      await this.syncState.setWatchState(input.projectName, {
        etag: null,
        cursor: null,
      });
      return;
    }

    await this.syncState.setWatchState(input.projectName, {
      etag: activity.etag,
      cursor: watch.cursor,
    });
  }
}
