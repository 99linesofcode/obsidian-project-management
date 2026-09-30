import { stateFromStatus } from '../Board/stateFromStatus.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { BoardStatusAction } from './BoardStatusAction.js';

export interface PropagateStatusInput {
  url: string;
  // The project's Status option name the note now carries.
  statusName: string;
  notePath: string;
  projectName: string;
}

// UC6/UC7: propagate a task note's status onto its GitHub issue and mirror it
// onto the board. The done lane closes the issue, every other lane reopens
// it; the card moves to the lane the note carries. The mirror's base lane is
// refreshed so the next pass sees the remote as settled (the echo guard).
//
// The issue state write is GATED: the base's lane already names the issue's
// open/closed state, so a lane that does not flip done-ness is not re-written.
// The gate IS the diff — only a real state change reaches GitHub.
export class PropagateStatusAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly boardStatus: BoardStatusAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: PropagateStatusInput): Promise<void> {
    const record = await this.syncState.findByMirror('github', input.url);
    const next = stateFromStatus(input.statusName, this.doneOptionName);
    const baseLane = record?.mirrors.github?.base?.status ?? '';
    const baseState = stateFromStatus(baseLane, this.doneOptionName);

    // No record: the note is untracked, so there is no baseline to compare
    // against and the state is written. A record whose base lane already
    // implies the same state is skipped (the write would be a no-op).
    if (record === null || baseState !== next) {
      await this.projectManagement.setTaskState(input.url, next);
    }

    await this.boardStatus.execute({
      projectName: input.projectName,
      url: input.url,
      statusName: input.statusName,
    });

    if (record === null) {
      return;
    }

    // Refresh the base's lane and completion so the echo guard sees the new
    // state. Only the lane dimension moves; content is untouched.
    const base = record.mirrors.github?.base ?? null;
    if (base !== null) {
      base.status = input.statusName;
      base.completedAt = next === 'closed' ? (base.completedAt ?? '') : null;
    }
    await this.syncState.set(record);
  }
}
