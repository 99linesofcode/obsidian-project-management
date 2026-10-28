import { freePath } from '../../../domain/paths.js';
import { stampNoteId } from '../../../domain/noteIdentity.js';
import { TaskNoteMapper } from './TaskNoteMapper.js';
import type { VaultPort } from '../../../port/VaultPort.js';
import type { RegistryPort } from '../../../port/RegistryPort.js';
import { readTemplate } from '../templates.js';

export interface CreateTaskNoteInput {
  url: string;
  title: string;
  body: string;
  type: string;
  projectName: string;
  projectId: string;
  connectionSlug: string;
  syncedAt: string;
  statusName: string;
  parentLink?: string | null;
}

export class CreateTaskNoteAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: RegistryPort,
    private readonly taskTemplatePath: string,
  ) {}

  async execute(input: CreateTaskNoteInput): Promise<void> {
    if (
      input.url !== '' &&
      (await this.syncState.findMirrorItem(input.connectionSlug, input.url)) !==
        null
    ) {
      return;
    }

    const id = crypto.randomUUID();
    const template = await readTemplate(this.vault, this.taskTemplatePath);
    const { path: base, content } = TaskNoteMapper.render(
      template,
      {
        type: input.type,
        title: input.title,
        body: input.body,
        createdAt: null,
      },
      {
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        statusName: input.statusName,
        ...(input.parentLink === undefined || input.parentLink === null
          ? {}
          : { parentLink: input.parentLink }),
      },
    );
    const path = await freePath(this.vault, base);

    await this.vault.createNote(path, stampNoteId(content, id));
    await this.syncState.setEntity({
      id,
      notePath: path,
      projectId: input.projectId,
    });
    if (input.url !== '') {
      await this.syncState.setMirrorItem(
        input.projectId,
        input.connectionSlug,
        input.url,
        {
          entityId: id,
        },
      );
    }
  }
}
