import type {
  AdoptTaskInput,
  TaskCaptureVaultPort,
} from '../../domain/ports/TaskCaptureVaultPort.js';
import { typeFromLabels } from '../../domain/typeFromLabels.js';
import type { CreateTaskNoteAction } from '../../domain/actions/CreateTaskNoteAction.js';
import type { NoteReaderPort } from '../../domain/ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../../domain/ports/NoteWriterPort.js';
import type { TrackedEntityPort } from '../../domain/ports/TrackedEntityPort.js';
import { CapturedTaskNoteMapper } from './CapturedTaskNoteMapper.js';
import { freePath } from '../../domain/freePath.js';

export class VaultTaskCaptureAdapter implements TaskCaptureVaultPort {
  constructor(
    private readonly vault: NoteReaderPort & NoteWriterPort,
    private readonly state: TrackedEntityPort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly isCodeHost: (application: string) => boolean,
  ) {}

  async listAdopted(project: string, slug: string): Promise<readonly string[]> {
    return (await this.state.listMirrorItems(project, slug)).map(
      ({ handle }) => handle,
    );
  }

  async adopt(input: AdoptTaskInput): Promise<void> {
    if (input.task.handle === '') {
      throw new Error('cannot adopt a task with an empty handle');
    }
    if (this.isCodeHost(input.application)) {
      await this.adoptCodeHostTask(input);
      return;
    }
    await this.adoptTaskManagerTask(input);
  }

  private async adoptCodeHostTask(input: AdoptTaskInput): Promise<void> {
    await this.createTaskNote.execute({
      url: input.task.handle,
      title: input.task.title,
      body: input.task.body,
      type: typeFromLabels([...input.task.labels]),
      projectName: input.projectName,
      connectionSlug: input.slug,
      syncedAt: input.syncedAt,
      statusName: input.task.status,
    });
  }

  private async adoptTaskManagerTask(input: AdoptTaskInput): Promise<void> {
    const rendered = CapturedTaskNoteMapper.map(
      {
        title: input.task.title,
        projectName: input.projectName,
        sliceLink: null,
      },
      { syncedAt: input.syncedAt, statusName: input.task.status },
    );
    const path = await freePath(this.vault, rendered.path);
    await this.vault.createNote(path, rendered.content);
    const id = crypto.randomUUID();
    await this.state.setEntity({ id, notePath: path });
    await this.state.setMirrorItem(
      input.projectName,
      input.slug,
      input.task.handle,
      { entityId: id, base: null },
    );
  }
}
