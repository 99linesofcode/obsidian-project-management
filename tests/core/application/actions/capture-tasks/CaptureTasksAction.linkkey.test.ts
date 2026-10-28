import { describe, expect, it } from 'vitest';
import { CaptureTasksAction } from '../../../../../src/core/application/actions/capture-tasks/CaptureTasksAction.js';
import { CreateTaskNoteAction } from '../../../../../src/core/application/actions/create-task-note/CreateTaskNoteAction.js';
import { CanonicalTask } from '../../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { typeFromLabels } from '../../../../../src/core/domain/note.js';
import { parseTaskNote } from '../../../../../src/infrastructure/vault/taskNoteCodec.js';
import type { MirrorPort } from '../../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { FakeVault as FakeVaultBase } from '../../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../../helpers/fakeSyncState.js';
import { entityRecord } from '../../../../helpers/records.js';

// CAP-4 / OQ-5 — capture's link key is the comparison form of the note's
// filename, not the note's declared `name:`. A remote task whose title matches
// exactly one existing note up to case, whitespace, a leading ordinal and a
// trailing collision suffix is linked to that note, and no second note is
// written. The filename is the title, so the link key reads the filename.

const SYNCED_AT = '2026-10-08T12:00:00Z';
const PROJECT = 'Acme';
const TYPED_NOTE = '---\nlabels: [type:task]\n---\n';

class FakeVault extends FakeVaultBase {
  readonly created: Array<{ path: string; content: string }> = [];
  private readonly notes = new Map<string, string>();

  constructor(
    private readonly connections: readonly ConnectionDataTransferObject[] = [
      connection('todoist', 'T1', 'td'),
    ],
  ) {
    super();
  }

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  override async readConnections(): Promise<
    readonly ConnectionDataTransferObject[]
  > {
    return this.connections;
  }

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }

  override async readTask(handle: string): Promise<CanonicalTask | null> {
    const content = this.notes.get(handle);
    if (content === undefined) {
      return null;
    }
    const note = parseTaskNote(content, handle);
    if (typeFromLabels(note.labels) === '') {
      return null;
    }
    return new CanonicalTask({
      handle,
      entityId: handle,
      title: note.title,
      body: note.body,
      status: note.status,
      completed: note.completed,
      parent: note.parent,
      labels: note.labels,
    });
  }
}

function task(handle: string, title: string): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: handle,
    title,
    body: '',
    status: '',
    completed: false,
    parent: null,
    labels: [],
  });
}

function connection(
  application: string,
  target: string,
  slug: string,
): ConnectionDataTransferObject {
  return new ConnectionDataTransferObject({ slug, application, target });
}

function registered(capture: {
  capture: (target: string) => Promise<CanonicalTask[]>;
}): MirrorPort {
  return capture as unknown as MirrorPort;
}

function harness(
  tasks: CanonicalTask[],
  connections: readonly ConnectionDataTransferObject[] = [
    connection('todoist', 'T1', 'td'),
  ],
): {
  action: CaptureTasksAction;
  vault: FakeVault;
  syncState: FakeSyncState;
} {
  const vault = new FakeVault(connections);
  const syncState = new FakeSyncState();
  const createTaskNote = new CreateTaskNoteAction(vault, syncState, '');
  const factory: MirrorAdapterFactoryPort = {
    create: () => registered({ capture: async () => tasks }),
  };
  return {
    action: new CaptureTasksAction(vault, factory, syncState, createTaskNote),
    vault,
    syncState,
  };
}

function seedNote(
  h: { vault: FakeVault; syncState: FakeSyncState },
  path: string,
): void {
  h.vault.seed(path, TYPED_NOTE);
  h.syncState.seed(entityRecord({ id: 'entity-existing', notePath: path }));
}

describe('CAP-4 / OQ-5 — capture links on the comparison form of the filename', () => {
  it('links a task to a note whose filename is exactly its title, writing no note', async () => {
    const h = harness([task('td-1', 'fix the bug')]);
    seedNote(h, `Projecten/${PROJECT}/taken/fix the bug.md`);

    await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.handleOf('entity-existing', 'td')).toBe('td-1');
  });

  it('links despite a case difference between the task title and the filename', async () => {
    const h = harness([task('td-1', 'fix the bug')]);
    seedNote(h, `Projecten/${PROJECT}/taken/Fix the Bug.md`);

    await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.handleOf('entity-existing', 'td')).toBe('td-1');
  });

  it('links despite a whitespace difference between the task title and the filename', async () => {
    const h = harness([task('td-1', 'fix  the  bug')]);
    seedNote(h, `Projecten/${PROJECT}/taken/fix the bug.md`);

    await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.handleOf('entity-existing', 'td')).toBe('td-1');
  });

  it('links despite a leading ordinal on the filename', async () => {
    const h = harness([task('td-1', 'fix the bug')]);
    seedNote(h, `Projecten/${PROJECT}/taken/61-fix the bug.md`);

    await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.handleOf('entity-existing', 'td')).toBe('td-1');
  });

  it('links despite a trailing collision suffix on the filename', async () => {
    const h = harness([task('td-1', 'fix the bug')]);
    seedNote(h, `Projecten/${PROJECT}/taken/fix the bug-2.md`);

    await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.handleOf('entity-existing', 'td')).toBe('td-1');
  });

  it('adopts a new note at the rendered filename when no filename matches (CAP-4, FN-1)', async () => {
    const h = harness([task('td-1', 'buy milk')]);
    h.vault.seed(`Projecten/${PROJECT}/taken/other.md`, TYPED_NOTE);

    const result = await h.action.invoke(
      { projectId: PROJECT, projectName: PROJECT },
      SYNCED_AT,
    );

    expect(result.captured).toEqual(['td-1']);
    expect(h.vault.created.map((note) => note.path)).toEqual([
      `Projecten/${PROJECT}/taken/buy milk.md`,
    ]);
  });
});
