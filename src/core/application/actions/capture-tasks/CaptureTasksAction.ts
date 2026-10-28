import type { CanonicalTask } from '../../../port/data/CanonicalTask.js';
import type { ConnectionDataTransferObject } from '../../../port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../../port/MirrorPort.js';
import type { RegistryPort } from '../../../port/RegistryPort.js';
import type { VaultPort } from '../../../port/VaultPort.js';
import { freePath } from '../../../domain/paths.js';
import {
  slugify,
  topLevelFrontmatterField,
  typeFromLabels,
} from '../../../domain/note.js';
import { noteId, stampNoteId } from '../../../domain/noteIdentity.js';
import { effectiveConnectionTarget } from '../../services/connectionTarget.js';
import type { ProjectReferenceDataTransferObject } from '../../data/ProjectReferenceDataTransferObject.js';
import type { CreateTaskNoteAction } from '../create-task-note/CreateTaskNoteAction.js';
import { CapturedTaskNoteMapper } from './CapturedTaskNoteMapper.js';

export interface CaptureTasksResult {
  captured: string[];
  errors: unknown[];
}

interface AdoptTaskInput {
  task: CanonicalTask;
  slug: string;
  project: ProjectReferenceDataTransferObject;
  syncedAt: string;
}

interface LinkCandidate {
  slug: string;
  path: string;
  id: string;
}

interface LinkCandidates {
  read(): Promise<LinkCandidate[]>;
  invalidate(): void;
}

export class CaptureTasksAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly factory: MirrorAdapterFactoryPort,
    private readonly registry: RegistryPort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async invoke(
    project: ProjectReferenceDataTransferObject,
    syncedAt: string,
  ): Promise<CaptureTasksResult> {
    const connections = await this.vault.readConnections(project.projectId);
    const captured: string[] = [];
    const errors: unknown[] = [];
    let candidates: LinkCandidate[] | null = null;
    const linkCandidates: LinkCandidates = {
      read: async () =>
        (candidates ??= await this.readLinkCandidates(project.projectName)),
      invalidate: () => {
        candidates = null;
      },
    };
    for (const connection of connections) {
      const target = await effectiveConnectionTarget(
        this.registry,
        project.projectId,
        connection,
      );
      if (target === null) {
        continue;
      }
      const adapter = this.factory.create(
        connection.application,
        target,
        connection.slug,
        project.projectId,
      );
      if (adapter === null || adapter.capture === undefined) {
        continue;
      }
      try {
        const result = await this.captureConnection(
          project,
          connection,
          target,
          adapter,
          syncedAt,
          linkCandidates,
        );
        captured.push(...result.captured);
        errors.push(...result.errors);
      } catch (error) {
        errors.push(error);
      }
    }
    return { captured, errors };
  }

  private async captureConnection(
    project: ProjectReferenceDataTransferObject,
    connection: ConnectionDataTransferObject,
    target: string,
    adapter: MirrorPort,
    syncedAt: string,
    linkCandidates: LinkCandidates,
  ): Promise<CaptureTasksResult> {
    if (adapter.capture === undefined) {
      return { captured: [], errors: [] };
    }
    const tasks = await adapter.capture(target);
    const adopted = new Set(
      (
        await this.registry.listMirrorItems(project.projectId, connection.slug)
      ).map(({ handle }) => handle),
    );

    const captured: string[] = [];
    const errors: unknown[] = [];
    for (const task of tasks) {
      if (adopted.has(task.handle)) {
        continue;
      }
      if ((await this.registry.findTombstone(task.handle)) !== null) {
        continue;
      }
      const slug = slugify(task.title);
      const matches =
        task.handle === ''
          ? []
          : (await linkCandidates.read()).filter((note) => note.slug === slug);
      if (matches.length > 1) {
        errors.push(
          ambiguousTitleError(project.projectName, task, matches.length),
        );
        continue;
      }
      try {
        const note = matches[0];
        if (note === undefined) {
          await this.adopt(
            {
              task,
              slug: connection.slug,
              project,
              syncedAt,
            },
            adapter.taskHandlesAreUrls?.() ?? false,
          );
          linkCandidates.invalidate();
        } else if (
          (await this.registry.resolveMirrorHandle(
            connection.slug,
            note.path,
          )) !== null
        ) {
          errors.push(linkedNoteError(project.projectName, task, note.path));
          continue;
        } else {
          await this.registry.recordMirrorHandle(
            project.projectId,
            connection.slug,
            note.path,
            note.id,
            task.handle,
          );
        }
      } catch (error) {
        errors.push(error);
        break;
      }
      captured.push(task.handle);
      adopted.add(task.handle);
    }
    return { captured, errors };
  }

  private async readLinkCandidates(
    projectName: string,
  ): Promise<LinkCandidate[]> {
    const paths = await this.vault.listNotesInFolder(
      `Projecten/${projectName}`,
    );
    const candidates: LinkCandidate[] = [];
    for (const path of paths) {
      const note = await this.vault.getNoteByPath(path);
      if (note === null) {
        continue;
      }
      const declared = topLevelFrontmatterField(note.content, 'name');
      if (declared === null || declared === '') {
        continue;
      }
      candidates.push({
        slug: slugify(declared),
        path,
        id: noteId(note.content) ?? path,
      });
    }
    return candidates;
  }

  private async adopt(
    input: AdoptTaskInput,
    handlesAreUrls: boolean,
  ): Promise<void> {
    if (input.task.handle === '') {
      throw new Error('cannot adopt a task with an empty handle');
    }
    if (handlesAreUrls) {
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
      projectName: input.project.projectName,
      projectId: input.project.projectId,
      connectionSlug: input.slug,
      syncedAt: input.syncedAt,
      statusName: input.task.status,
    });
  }

  private async adoptTaskManagerTask(input: AdoptTaskInput): Promise<void> {
    const rendered = CapturedTaskNoteMapper.map(
      {
        title: input.task.title,
        projectName: input.project.projectName,
        sliceLink: null,
        kind: capturedKind(input.task),
      },
      { syncedAt: input.syncedAt, statusName: input.task.status },
    );
    const path = await freePath(this.vault, rendered.path);
    const id = crypto.randomUUID();
    await this.vault.createNote(path, stampNoteId(rendered.content, id));
    await this.registry.setEntity({
      id,
      notePath: path,
      projectId: input.project.projectId,
    });
    await this.registry.setMirrorItem(
      input.project.projectId,
      input.slug,
      input.task.handle,
      { entityId: id },
    );
  }
}

function capturedKind(task: CanonicalTask): string {
  const explicit = typeFromLabels(task.labels);
  if (explicit !== '') {
    return explicit;
  }
  return task.parent !== null ? 'task' : 'slice';
}

function ambiguousTitleError(
  projectName: string,
  task: CanonicalTask,
  matches: number,
): Error {
  return new Error(
    `cannot capture ${task.handle}: ${matches} notes in project "${projectName}" share the title "${task.title}"`,
  );
}

function linkedNoteError(
  projectName: string,
  task: CanonicalTask,
  notePath: string,
): Error {
  return new Error(
    `cannot capture ${task.handle}: ${notePath} in project "${projectName}" is already linked to another task`,
  );
}
