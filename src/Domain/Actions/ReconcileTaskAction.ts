import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { taskStatusFromState } from '../Enums/TaskStatus.js';
import type { Status } from '../Models/Status.js';
import { TaskNoteParser, withStatus } from '../Notes/TaskNoteParser.js';
import { slugify, titleFromNotePath } from '../Notes/TaskNoteMapper.js';
import { hash } from '../Notes/hash.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import { ObservedState } from '../Reconciliation/ObservedState.js';
import { VerdictResolver } from '../Reconciliation/VerdictResolver.js';
import type { ApplyRemoteChangeAction } from './ApplyRemoteChangeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { PropagateStatusAction } from './PropagateStatusAction.js';
import type { PushNoteAction } from './PushNoteAction.js';

export interface ReconcileTaskInput {
  notePath: string;
  projectName: string;
  syncedAt: string;
}

// UC4/UC6: reconcile a note edit. Reads the note, reconciles it against the
// remote and the last-synced baseline, and pushes the note's body (and title
// when the filename was renamed) and status onto the GitHub issue. The
// verdict's 'none' cell is the echo guard: every write refreshes the full
// baseline, so our own writes never bounce back as a push.
export class ReconcileTaskAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly applyRemoteChange: ApplyRemoteChangeAction,
    private readonly pushNote: PushNoteAction,
    private readonly propagateStatus: PropagateStatusAction,
    private readonly verdictResolver: VerdictResolver,
  ) {}

  async execute(input: ReconcileTaskInput): Promise<void> {
    const note = await this.vault.getNoteByPath(input.notePath);
    if (!note) {
      return;
    }

    const parsed = TaskNoteParser.parse(note.content);
    if (!parsed) {
      return;
    }

    const remote = await this.projectManagement.fetchTask(parsed.url);

    const status = await this.syncState.get(parsed.url);
    if (!status) {
      await this.createTaskNote.execute({
        task: remote,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
      return;
    }

    const currentTitle = titleFromNotePath(input.notePath, status.remoteId);

    const observed = new ObservedState(
      { body: parsed.body, status: parsed.status },
      {
        body: remote.body,
        status: taskStatusFromState(remote.state),
        updatedAt: remote.updatedAt,
      },
      {
        lastSyncedBodyHash: status.lastSyncedBodyHash,
        lastSyncedRemoteUpdatedAt: status.lastSyncedRemoteUpdatedAt,
        lastSyncedStatus: status.lastSyncedStatus,
      },
    );

    const verdict = this.verdictResolver.resolve(observed);

    // Body dimension: push the note's body (and title when the filename was
    // renamed) when the note changed; pull the remote body when only the
    // remote changed.
    if (verdict.body === 'push' || verdict.body === 'conflict') {
      const titleChanged = slugify(currentTitle) !== slugify(status.lastSyncedTitle);
      const updated = await this.pushNote.execute({
        url: parsed.url,
        title: titleChanged ? currentTitle : status.lastSyncedTitle,
        body: parsed.body,
      });
      await this.refreshBaseline(status, updated, input.notePath);
    } else if (verdict.body === 'pull') {
      await this.applyRemoteChange.execute({
        task: remote,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
    }

    // Status dimension: a local status flip (or a conflict, where the note
    // wins) propagates the note's status to the remote. A remote-only status
    // change mirrors onto the note — via a targeted status-only rewrite when
    // the body was just pushed (a full apply would clobber the pushed body),
    // via the full apply otherwise.
    if (verdict.status === 'push' || verdict.status === 'conflict') {
      await this.propagateStatus.execute({
        url: parsed.url,
        status: parsed.status,
        notePath: input.notePath,
      });
    } else if (verdict.status === 'pull') {
      if (verdict.body === 'push' || verdict.body === 'conflict') {
        await this.applyStatusToNote(input.notePath, taskStatusFromState(remote.state));
      } else if (verdict.body === 'none') {
        await this.applyRemoteChange.execute({
          task: remote,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      }
    }
  }

  // Rewrites just the note's frontmatter status line, keeping the body that
  // was just pushed. The body push above already refreshed the baseline, so
  // the note and the baseline now agree on the mirrored status.
  private async applyStatusToNote(notePath: string, status: 'open' | 'done'): Promise<void> {
    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }
    await this.vault.writeNote(notePath, withStatus(note.content, status));
  }

  private async refreshBaseline(status: Status, updated: TaskData, notePath: string): Promise<void> {
    await this.syncState.set({
      url: status.url,
      remoteId: status.remoteId,
      notePath,
      lastSyncedBodyHash: hash(updated.body),
      lastSyncedRemoteUpdatedAt: updated.updatedAt,
      lastSyncedStatus: taskStatusFromState(updated.state),
      lastSyncedTitle: updated.title,
    });
  }
}
