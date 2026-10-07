import type { ProjectManagementPort } from '../shared/ProjectManagementPort.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import { defaultStatusName } from '../projects/defaultStatusName.js';
import { typeFromLabels } from '../shared/typeFromLabels.js';

export interface PromoteCardInput {
  itemId: string;
  repoNodeId: string;
  projectName: string;
}

// UC: promote a board card into a tracked task with a note. The note starts
// in the project's default lane.
export class PromoteCardAction {
  constructor(
    private readonly port: ProjectManagementPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly vault: VaultPort,
  ) {}

  async execute(input: PromoteCardInput): Promise<void> {
    const task = await this.port.promoteCard(input.itemId, input.repoNodeId);

    const identity = await this.syncState.getIdentity(input.projectName);
    await this.createTaskNote.execute({
      url: task.url,
      title: task.title,
      body: task.body,
      type: typeFromLabels(task.labels),
      projectName: input.projectName,
      connectionSlug: await this.githubSlug(input.projectName),
      syncedAt: new Date().toISOString(),
      statusName: defaultStatusName(identity?.statusOptions ?? []),
    });
  }

  // The project's code-host connection slug, so the promoted note's mirror is
  // registered under the connection the card belongs to.
  private async githubSlug(projectName: string): Promise<string> {
    const notes = await this.vault.findProjectNotes();
    const note = notes.find((candidate) => candidate.projectName === projectName);
    if (note !== undefined) {
      for (const [slug, connection] of Object.entries(note.connections)) {
        if (connection.tool === 'github') {
          return slug;
        }
      }
    }
    return 'github';
  }
}
