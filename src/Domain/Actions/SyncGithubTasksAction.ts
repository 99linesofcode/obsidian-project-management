import type { BoardItemData } from '../DataTransferObjects/BoardItemData.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import { defaultStatusName } from '../Board/defaultStatusName.js';
import { statusNameFromState } from '../Board/statusNameFromState.js';
import { hasTypeLabel } from '../Labels/hasTypeLabel.js';
import { GithubTaskMapper } from '../Mappers/GithubTaskMapper.js';
import { VaultTaskMapper } from '../Mappers/VaultTaskMapper.js';
import { toIssueBody } from '../Notes/Checklist.js';
import { hash } from '../Notes/hash.js';
import { slugify } from '../Notes/TaskNoteMapper.js';
import { VerdictResolver } from '../Reconciliation/VerdictResolver.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { ApplyTaskToGithubAction } from './ApplyTaskToGithubAction.js';
import type { ApplyTaskToVaultAction } from './ApplyTaskToVaultAction.js';

export interface SyncGithubTasksInput {
  projectName: string;
  syncedAt: string;
  // The probe's verdict: the project's remote updatedAt moved since the last
  // poll. When false, the fetch is skipped unless the vault drifted.
  includeBoard: boolean;
}

// The GitHub half on the canonical pipeline: probe gate → single-query project
// detail fetch → GithubTaskMapper maps every issue+card to canonical TaskData →
// VerdictResolver.diff(vault, remote, snapshot) per entity → the two writers
// apply the winning side. Replaces the t2 interim (probe → old sweep → per-note
// consistency loop).
//
// The snapshot DTO is read straight from the canonical store (one TaskData per
// issue); its body field carries the comparable issue-body hash, and the
// pipeline hashes the vault/remote bodies before diffing, so the canonical
// diff's string comparison is a hash comparison. Titles are slug-compared,
// because the vault's title is filename-derived and the remote's is the issue
// title.
export class SyncGithubTasksAction {
  constructor(
    private readonly projectManagement: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly vault: VaultPort,
    private readonly applyToGithub: ApplyTaskToGithubAction,
    private readonly applyToVault: ApplyTaskToVaultAction,
    private readonly verdictResolver: VerdictResolver,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: SyncGithubTasksInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    if (!identity?.repoUrl) {
      throw new Error(
        `SyncGithubTasksAction: no repo url for project ${input.projectName}`,
      );
    }

    const statuses = await this.syncState.list();
    const statusByUrl = new Map(statuses.map((s) => [s.url, s] as const));

    // The probe gate: skip the whole fetch when the remote is unmoved and the
    // vault is settled. A vault-side drift re-opens it so the drift can be
    // pushed; a project with no records is unknown, so it fetches.
    if (
      !input.includeBoard &&
      !(await this.hasVaultDrift(input.projectName, statuses))
    ) {
      return;
    }

    const detail = await this.projectManagement.fetchProjectDetail(
      identity.repoUrl,
      identity.projectNodeId,
    );
    const issues = detail.issues.filter((issue) => hasTypeLabel(issue.labels));
    const cardByUrl = new Map(
      detail.cards
        .filter((card) => card.issueUrl !== undefined)
        .map((card) => [card.issueUrl as string, card] as const),
    );

    const doneLane = this.doneOptionName;
    const defaultLane = defaultStatusName(identity.statusOptions);

    for (const issue of issues) {
      const card = cardByUrl.get(issue.url) ?? null;
      const status = statusByUrl.get(issue.url);
      const rawRemote = GithubTaskMapper.parse(issue, card);
      // The board lane is authoritative for done-ness when a card carries one;
      // a card with no lane falls back to the record's lane (backfill); a
      // card-less issue falls back to the lane its state implies.
      const remote = this.withLaneDone(
        rawRemote,
        card,
        issue.state,
        doneLane,
        defaultLane,
        status,
      );

      // An untracked issue: materialise the note and add the card. A closed
      // untracked issue is skipped — it is either swept or pre-plugin history,
      // and the vault is the source of truth. Reopening it on GitHub makes it an
      // open untracked issue, so it materialises then. The raw state is read
      // from the fetched issue, not the lane-derived `completed` (a closed issue
      // with a stale card in an active lane derives completed=false).
      if (!status) {
        if (issue.state === 'closed') {
          continue;
        }
        await this.applyToVault.execute({
          task: remote,
          current: null,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
        await this.applyToGithub.execute({
          task: remote,
          current: rawRemote,
          hasCard: card !== null,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
        continue;
      }

      const note = await this.vault.getNoteByPath(status.notePath);
      const vaultDto = note
        ? VaultTaskMapper.parseTask(note.content, status.notePath, {
            projectName: input.projectName,
            doneLane,
          })
        : null;
      // The note is gone; the deletion sweep owns it.
      if (!vaultDto) {
        continue;
      }

      const snapshot = this.snapshotForDiff(status, doneLane);
      const verdict = this.verdictResolver.diff(
        this.forDiff(vaultDto, hash(toIssueBody(vaultDto.body))),
        this.forDiff(remote, hash(remote.body)),
        this.forDiff(snapshot, snapshot.body),
      );

      if (verdict === 'push' || verdict === 'conflict') {
        await this.applyToGithub.execute({
          task: vaultDto,
          current: rawRemote,
          hasCard: card !== null,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      } else if (verdict === 'pull') {
        await this.applyToVault.execute({
          task: remote,
          current: vaultDto,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
        // The board lane's done-ness drives the issue state: reconcile the
        // issue when the remote's own fields disagree.
        if (remote.completed !== rawRemote.completed) {
          await this.applyToGithub.execute({
            task: remote,
            current: rawRemote,
            hasCard: card !== null,
            projectName: input.projectName,
            syncedAt: input.syncedAt,
          });
        }
      } else if (card === null || card.statusOptionName === undefined) {
        // A membership gap (no card) or a lane gap (a card with no lane): the
        // writer adds or backfills it in the winning lane.
        await this.applyToGithub.execute({
          task: remote,
          current: rawRemote,
          hasCard: card !== null,
          projectName: input.projectName,
          syncedAt: input.syncedAt,
        });
      }
    }
  }

  // The board lane is authoritative for done-ness when a card carries one; a
  // card with no lane falls back to the record's lane (backfill); a card-less
  // issue falls back to the lane its state implies.
  private withLaneDone(
    raw: TaskData,
    card: BoardItemData | null,
    state: 'open' | 'closed',
    doneLane: string,
    defaultLane: string,
    status: TaskData | undefined,
  ): TaskData {
    if (card && card.statusOptionName !== undefined) {
      return {
        ...raw,
        status: card.statusOptionName,
        completed: card.statusOptionName === doneLane,
      };
    }
    if (card) {
      const lane =
        status?.status ?? statusNameFromState(state, doneLane, defaultLane);
      return { ...raw, status: lane, completed: lane === doneLane };
    }
    return {
      ...raw,
      status: statusNameFromState(state, doneLane, defaultLane),
      completed: state === 'closed',
    };
  }

  // The canonical snapshot the diff reads, straight from the store. The stored
  // record already carries the canonical content (the body as the comparable
  // hash); the only derived field is `completed`, re-read from the lane so a
  // migrated pre-t5 record resolves correctly.
  private snapshotForDiff(status: TaskData, doneLane: string): TaskData {
    return {
      ...status,
      completed: doneLane !== '' && status.status === doneLane,
    };
  }

  // The comparable shape the diff reads: the title is slug-compared (the vault
  // derives it from the filename, the remote from the issue title) and the
  // body is the caller's comparable form (the issue-body hash). Parent is not a
  // GitHub-synced field.
  private forDiff(task: TaskData, body: string): TaskData {
    return { ...task, title: slugify(task.title), body, parent: null };
  }

  // A vault-side drift: a project record whose note no longer matches its
  // snapshot. A project with no records is unknown and counts as drift, so a
  // newly tracked issue is never starved by the probe gate.
  private async hasVaultDrift(
    projectName: string,
    statuses: TaskData[],
  ): Promise<boolean> {
    const prefix = `Projecten/${projectName}/`;
    const projectStatuses = statuses.filter((s) =>
      s.notePath.startsWith(prefix),
    );
    if (projectStatuses.length === 0) {
      return true;
    }

    for (const status of projectStatuses) {
      const note = await this.vault.getNoteByPath(status.notePath);
      if (!note) {
        continue;
      }
      const parsed = VaultTaskMapper.parseTask(note.content, status.notePath, {
        projectName,
        doneLane: this.doneOptionName,
      });
      if (!parsed) {
        return true;
      }
      if (hash(toIssueBody(parsed.body)) !== status.body) {
        return true;
      }
      if (parsed.status !== status.status) {
        return true;
      }
      if (slugify(parsed.title) !== slugify(status.title)) {
        return true;
      }
    }
    return false;
  }
}
