import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';

export interface PushNoteInput {
  url: string;
  title: string;
  body: string;
}

// UC4: push a note's content onto its GitHub issue. The title is derived from
// the note's filename slug (dashes → spaces). The slug round-trips lossily —
// it cannot recover the original casing or punctuation — but readably; the
// filename slug is the user's chosen naming, so it wins.
export class PushNoteAction {
  constructor(private readonly projectManagement: ProjectManagementPort) {}

  async execute(input: PushNoteInput): Promise<TaskData> {
    return this.projectManagement.updateTask(input.url, {
      title: input.title,
      body: input.body,
    });
  }
}
