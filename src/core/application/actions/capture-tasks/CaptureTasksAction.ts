import type { CanonicalTask } from '../../../port/data/CanonicalTask.js';
import type { ConnectionDataTransferObject } from '../../../port/data/ConnectionDataTransferObject.js';
import type { MirrorAdapterFactoryPort } from '../../../port/MirrorAdapterFactoryPort.js';
import type { MirrorPort } from '../../../port/MirrorPort.js';
import type { RegistryPort } from '../../../port/RegistryPort.js';
import type { VaultPort } from '../../../port/VaultPort.js';
import { freePath } from '../../../domain/paths.js';
import { slugify, typeFromLabels } from '../../../domain/note.js';
import { effectiveConnectionTarget } from '../../services/connectionTarget.js';
import type { CreateTaskNoteAction } from '../create-task-note/CreateTaskNoteAction.js';
import { CapturedTaskNoteMapper } from './CapturedTaskNoteMapper.js';

export interface CaptureTasksResult {
  captured: string[];
  errors: unknown[];
}

interface AdoptTaskInput {
  task: CanonicalTask;
  slug: string;
  projectName: string;
  syncedAt: string;
}

interface LinkCandidate {
  slug: string;
  path: string;
}

interface LinkCandidates {
  read(): Promise<LinkCandidate[]>;
  invalidate(): void;
}

// The capture-adoption orchestration: for a code-host task it starts
// `CreateTaskNoteAction`; for a task-manager task it renders the draft note
// (the pure mapper) and writes it through `VaultPort` + `RegistryPort`.
// The driven adapters stay raw I/O — no adapter starts a use case.
export class CaptureTasksAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly factory: MirrorAdapterFactoryPort,
    private readonly registry: RegistryPort,
    private readonly createTaskNote: CreateTaskNoteAction,
  ) {}

  async invoke(project: string, syncedAt: string): Promise<CaptureTasksResult> {
    const connections = await this.vault.readConnections(project);
    const captured: string[] = [];
    const errors: unknown[] = [];
    let candidates: LinkCandidate[] | null = null;
    const linkCandidates: LinkCandidates = {
      read: async () => (candidates ??= await this.readLinkCandidates(project)),
      invalidate: () => {
        candidates = null;
      },
    };
    for (const connection of connections) {
      const target = await effectiveConnectionTarget(
        this.registry,
        project,
        connection,
      );
      if (target === null) {
        continue;
      }
      const adapter = this.factory.create(
        connection.application,
        target,
        connection.slug,
        project,
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
    project: string,
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
      (await this.registry.listMirrorItems(project, connection.slug)).map(
        ({ handle }) => handle,
      ),
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
        errors.push(ambiguousTitleError(project, task, matches.length));
        continue;
      }
      try {
        const note = matches[0];
        if (note === undefined) {
          await this.adopt({
            task,
            slug: connection.slug,
            projectName: project,
            syncedAt,
          });
          linkCandidates.invalidate();
        } else if (
          (await this.registry.resolveMirrorHandle(
            connection.slug,
            note.path,
          )) !== null
        ) {
          errors.push(linkedNoteError(project, task, note.path));
          continue;
        } else {
          await this.registry.recordMirrorHandle(
            project,
            connection.slug,
            note.path,
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

  private async readLinkCandidates(project: string): Promise<LinkCandidate[]> {
    const paths = await this.vault.listNotesInFolder(`Projecten/${project}`);
    const candidates: LinkCandidate[] = [];
    for (const path of paths) {
      const note = await this.vault.readTask(path);
      if (note !== null) {
        candidates.push({ slug: slugify(note.title), path });
      }
    }
    return candidates;
  }

  private async adopt(input: AdoptTaskInput): Promise<void> {
    if (input.task.handle === '') {
      throw new Error('cannot adopt a task with an empty handle');
    }
    if (isCodeHostHandle(input.task.handle)) {
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
        kind: capturedKind(input.task),
      },
      { syncedAt: input.syncedAt, statusName: input.task.status },
    );
    const path = await freePath(this.vault, rendered.path);
    await this.vault.createNote(path, rendered.content);
    const id = crypto.randomUUID();
    await this.registry.setEntity({ id, notePath: path });
    await this.registry.setMirrorItem(
      input.projectName,
      input.slug,
      input.task.handle,
      { entityId: id },
    );
  }
}

// A captured task's handle decides the adoption shape: a code host's issue is
// addressed by its url and becomes a task note; a task manager's item carries
// an opaque id and becomes a draft note.
function isCodeHostHandle(handle: string): boolean {
  return handle.startsWith('http://') || handle.startsWith('https://');
}

// The kind a task-manager capture carries: its explicit type label when it has
// one, otherwise the kind its position implies — a root item is a slice, a
// subtask is a task.
function capturedKind(task: CanonicalTask): string {
  const explicit = typeFromLabels(task.labels);
  if (explicit !== '') {
    return explicit;
  }
  return task.parent !== null ? 'task' : 'slice';
}

function ambiguousTitleError(
  project: string,
  task: CanonicalTask,
  matches: number,
): Error {
  return new Error(
    `cannot capture ${task.handle}: ${matches} notes in project "${project}" share the title "${task.title}"`,
  );
}

function linkedNoteError(
  project: string,
  task: CanonicalTask,
  notePath: string,
): Error {
  return new Error(
    `cannot capture ${task.handle}: ${notePath} in project "${project}" is already linked to another task`,
  );
}
