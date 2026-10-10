import { freePath } from '../../domain/freePath.js';
import { TaskNoteMapper } from '../../domain/TaskNoteMapper.js';
import type { NoteReaderPort } from '../../port/NoteReaderPort.js';
import type { NoteWriterPort } from '../../port/NoteWriterPort.js';
import type { TrackedEntityPort } from '../../port/TrackedEntityPort.js';
import { readTemplate } from '../../domain/readTemplate.js';

export interface CreateTaskNoteInput {
  url: string;
  title: string;
  body: string;
  type: string;
  projectName: string;
  connectionSlug: string;
  syncedAt: string;
  statusName: string;
  parentLink?: string | null;
}

export class CreateTaskNoteAction {
  constructor(
    private readonly vault: NoteReaderPort & NoteWriterPort,
    private readonly syncState: TrackedEntityPort,
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

    await this.vault.createNote(path, content);
    await this.syncState.setEntity({ id, notePath: path });
    if (input.url !== '') {
      await this.syncState.setMirrorItem(
        input.projectName,
        input.connectionSlug,
        input.url,
        {
          entityId: id,
          base: null,
        },
      );
    }
  }

  // The template note's content, or null when it does not exist — render
  // falls back to the built-in frontmatter.
}
