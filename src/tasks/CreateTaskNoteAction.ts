import { freePath } from '../vault/freePath.js';
import { TaskNoteMapper } from '../vault/TaskNoteMapper.js';
import type { SyncStatePort } from '../registry/SyncStatePort.js';
import { readTemplate } from '../vault/readTemplate.js';
import type { VaultPort } from '../vault/VaultPort.js';

export interface CreateTaskNoteInput {
  // The issue url when the note is GitHub-backed; '' for a vault-only note.
  // Recorded as the github mirror handle so a later pass resolves the entity.
  url: string;
  title: string;
  body: string;
  // The vault-owned content type (from the winning task or the promoted label).
  type: string;
  projectName: string;
  syncedAt: string;
  // The project's Status option name the task starts in.
  statusName: string;
  // The parent note's stem when the issue is a sub-issue of a tracked parent;
  // null/absent for a top-level issue. Seeds the note's affiliation so the
  // parent relation has a vault home from creation.
  parentLink?: string | null;
}

// UC2: materialise a task note. Idempotent — an issue already registered keeps
// its note. Otherwise the note is created with a fresh vault-owned uuid, named
// by title slug (ordinal-suffixed on collision), and its registry record is
// written with the github handle when the task has one.
export class CreateTaskNoteAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly taskTemplatePath: string,
  ) {}

  async execute(input: CreateTaskNoteInput): Promise<void> {
    // The registry is the identity check now: the slug filename is shared by
    // any task with the same title, so path existence no longer means "ours".
    if (
      input.url !== '' &&
      (await this.syncState.findMirrorItem('github', input.url)) !== null
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
    // A title slug can collide with another task; freePath appends the ordinal
    // so the name stays human-readable and unique.
    const path = await freePath(this.vault, base);

    await this.vault.createNote(path, content);
    await this.syncState.setEntity({ id, notePath: path });
    if (input.url !== '') {
      await this.syncState.setMirrorItem(input.projectName, 'github', input.url, {
        entityId: id,
        base: null,
      });
    }
  }

  // The template note's content, or null when it does not exist — render
  // falls back to the built-in frontmatter.

}
