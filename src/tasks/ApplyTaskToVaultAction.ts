import { TaskData } from '../shared/TaskData.js';
import { withChecklistLinks } from '../vault/Checklist.js';
import { freePath } from '../vault/freePath.js';
import { parseAffiliation } from '../shared/parseAffiliation.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { normalizedStem, stemOf } from '../shared/stemOf.js';
import { taskLinkFromAffiliation } from '../shared/taskLinkFromAffiliation.js';
import { TaskNoteMapper, slugify } from '../vault/TaskNoteMapper.js';
import { ToDoNoteParser } from '../vault/ToDoNoteParser.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import { readTemplate } from '../vault/readTemplate.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { CompleteTaskCascadeAction } from './CompleteTaskCascadeAction.js';
import type { CreateTaskNoteAction } from './CreateTaskNoteAction.js';

export interface ApplyTaskToVaultInput {
  task: TaskData;
  current: TaskData | null;
  projectName: string;
  connectionSlug: string;
  syncedAt: string;
  origin: 'pull' | 'push';
  record?: EntityRecord | null;
}

export class ApplyTaskToVaultAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly createTaskNote: CreateTaskNoteAction,
    private readonly taskTemplatePath: string,
    private readonly completeTaskCascade: CompleteTaskCascadeAction,
  ) {}

  async execute(input: ApplyTaskToVaultInput): Promise<void> {
    const record =
      input.record ??
      (input.current === null
        ? null
        : await this.syncState.findByNotePath(input.current.notePath));

    if (input.current === null) {
      const parent = await this.resolveParent(input);
      const parentLink = await this.parentLink(parent);
      await this.createTaskNote.execute({
        url: await this.issueUrl(input, record),
        title: input.task.title,
        body: input.task.body,
        type: input.task.type,
        projectName: input.projectName,
        connectionSlug: input.connectionSlug,
        syncedAt: input.syncedAt,
        statusName: input.task.status,
        ...(parentLink === null ? {} : { parentLink }),
      });
      const created = await this.createdRecord(input, record);
      const path = created?.notePath ?? this.mappedPath(input);
      await this.refreshRecord(
        input,
        created,
        this.appliedTask(input, created?.id ?? input.task.id, path, parent),
      );
      await this.completeTaskCascade.execute({
        notePath: path,
        projectName: input.projectName,
        syncedAt: input.syncedAt,
      });
      return;
    }

    const id = record?.id ?? input.current.id ?? input.task.id;
    const parent = await this.resolveParent(input);
    const parentLink = await this.parentLink(parent);
    const linkedBody = await this.linkedBody(
      input.task.body,
      input.projectName,
    );
    const template = await readTemplate(this.vault, this.taskTemplatePath);
    const rendered = TaskNoteMapper.render(
      template,
      {
        type: input.task.type || input.current.type,
        title: input.task.title,
        body: linkedBody,
        createdAt: input.current.createdAt,
      },
      {
        projectName: input.projectName,
        syncedAt: input.syncedAt,
        statusName: input.task.status,
        ...(parentLink === null ? {} : { parentLink }),
      },
    );

    const path = await this.desiredPath(input.current.notePath, rendered.path);
    const existing = await this.vault.getNoteByPath(input.current.notePath);
    const content = rendered.content;
    if (input.current.notePath !== path) {
      await this.vault.renameNote(input.current.notePath, path);
    }
    if ((existing?.content ?? '') !== content) {
      await this.vault.writeNote(path, content);
    }

    await this.completeTaskCascade.execute({
      notePath: path,
      projectName: input.projectName,
      syncedAt: input.syncedAt,
    });

    await this.refreshRecord(
      input,
      record,
      this.appliedTask(input, id, path, parent),
    );
  }

  private async issueUrl(
    input: ApplyTaskToVaultInput,
    record: EntityRecord | null,
  ): Promise<string> {
    if (input.task.mirrors.github !== undefined) {
      return input.task.mirrors.github;
    }
    return record === null
      ? ''
      : ((await this.githubHandle(input.connectionSlug, record.id)) ?? '');
  }

  private async githubHandle(
    connectionSlug: string,
    entityId: string,
  ): Promise<string | null> {
    return (
      (await this.syncState.findMirrorItemByEntity(connectionSlug, entityId))
        ?.handle ?? null
    );
  }

  private async createdRecord(
    input: ApplyTaskToVaultInput,
    record: EntityRecord | null,
  ): Promise<EntityRecord | null> {
    const url = await this.issueUrl(input, record);
    if (url !== '') {
      const item = await this.syncState.findMirrorItem(
        input.connectionSlug,
        url,
      );
      return item === null ? null : this.syncState.getEntity(item.entityId);
    }
    return await this.syncState.findByNotePath(this.mappedPath(input));
  }

  private appliedTask(
    input: ApplyTaskToVaultInput,
    id: string,
    notePath: string,
    parent: string | null,
  ): TaskData {
    return new TaskData({
      id: id,
      notePath: notePath,
      mirrors: {},
      title: input.task.title,
      body: input.task.body,
      status: input.task.status,
      completedAt: input.task.completedAt,
      type: input.task.type,
      parent: parent,
      createdAt: input.task.createdAt,
      updatedAt: input.task.updatedAt,
    });
  }

  private mappedPath(input: ApplyTaskToVaultInput): string {
    return TaskNoteMapper.map(
      {
        type: '',
        title: input.task.title,
        body: '',
        createdAt: null,
      },
      {
        projectName: input.projectName,
        syncedAt: '',
        statusName: '',
      },
    ).path;
  }

  private async desiredPath(
    currentPath: string,
    renderedPath: string,
  ): Promise<string> {
    if (currentPath === renderedPath) {
      return renderedPath;
    }
    if (normalizedStem(currentPath) === normalizedStem(renderedPath)) {
      return currentPath;
    }
    return await freePath(this.vault, renderedPath);
  }

  private async resolveParent(
    input: ApplyTaskToVaultInput,
  ): Promise<string | null> {
    const direct = await this.resolveParentRef(
      input.task.parent,
      input.projectName,
    );
    if (direct !== null) {
      return direct;
    }
    if (input.current === null) {
      return null;
    }
    const note = await this.vault.getNoteByPath(input.current.notePath);
    if (note === null) {
      return null;
    }
    const fields = splitFrontmatter(note.content)?.fields;
    if (fields === undefined) {
      return null;
    }
    const link = taskLinkFromAffiliation(
      parseAffiliation(fields.get('affiliation')),
      input.projectName,
    );
    return await this.resolveParentRef(link, input.projectName);
  }

  private async resolveParentRef(
    ref: string | null,
    projectName: string,
  ): Promise<string | null> {
    if (ref === null || ref === '') {
      return null;
    }
    if ((await this.syncState.getEntity(ref)) !== null) {
      return ref;
    }
    for (const candidate of [
      ref,
      `Projecten/${projectName}/taken/${ref}.md`,
      `Projecten/${projectName}/todos/${ref}.md`,
    ]) {
      const record = await this.syncState.findByNotePath(candidate);
      if (record !== null) {
        return record.id;
      }
    }
    return null;
  }

  private async parentLink(parentUuid: string | null): Promise<string | null> {
    if (parentUuid === null) {
      return null;
    }
    const record = await this.syncState.getEntity(parentUuid);
    return record === null ? null : stemOf(record.notePath);
  }

  private async linkedBody(body: string, projectName: string): Promise<string> {
    const bySlug = await this.todoPathsBySlug(projectName);
    return withChecklistLinks(
      body,
      (text) => bySlug.get(slugify(text)) ?? null,
    );
  }

  private async todoPathsBySlug(
    projectName: string,
  ): Promise<Map<string, string>> {
    const bySlug = new Map<string, string>();
    const folder = `Projecten/${projectName}/todos`;

    for (const path of await this.vault.listNotesInFolder(folder)) {
      const note = await this.vault.getNoteByPath(path);
      if (!note || ToDoNoteParser.parse(note.content) === null) {
        continue;
      }
      const stem = stemOf(path);
      if (!bySlug.has(stem)) {
        bySlug.set(stem, path);
      }
    }

    return bySlug;
  }

  private async refreshRecord(
    input: ApplyTaskToVaultInput,
    record: EntityRecord | null,
    applied: TaskData,
  ): Promise<void> {
    const id = record?.id ?? applied.id;
    if (id === '') {
      return;
    }
    await this.syncState.setEntity({ id, notePath: applied.notePath });
    if (input.origin === 'pull') {
      const handle = await this.issueUrl(input, record);
      if (handle !== '') {
        await this.syncState.setMirrorItem(
          input.projectName,
          input.connectionSlug,
          handle,
          {
            entityId: id,
            base: toDiffViewWithBody(applied),
          },
        );
      }
    }
  }
}
