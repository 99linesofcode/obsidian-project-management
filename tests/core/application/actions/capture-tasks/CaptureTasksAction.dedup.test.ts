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

const SYNCED_AT = '2026-10-08T12:00:00Z';
const PROJECT = 'Acme';
const EXISTING = `Projecten/${PROJECT}/taken/fix-the-bug.md`;
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

describe('CaptureTasksAction — capture links a task whose title already exists (CAP-4)', () => {
  it('links a remote task to the one existing note with that title, writing no note (CAP-4, I16)', async () => {
    const h = harness([task('td-1', 'fix the bug')]);
    h.vault.seed(EXISTING, TYPED_NOTE);
    h.syncState.seed(entityRecord({ id: 'entity-existing', notePath: EXISTING }));

    await h.action.invoke(PROJECT, SYNCED_AT);

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.handleOf('entity-existing', 'td')).toBe('td-1');
  });

  it('adopts a remote task as a new note when no note shares its title (CAP-4, CAP-2)', async () => {
    const h = harness([task('td-1', 'buy milk')]);
    h.vault.seed(`Projecten/${PROJECT}/taken/other.md`, TYPED_NOTE);

    const result = await h.action.invoke(PROJECT, SYNCED_AT);

    expect(result.captured).toEqual(['td-1']);
    expect(h.vault.created.map((note) => note.path)).toEqual([
      `Projecten/${PROJECT}/taken/buy-milk.md`,
    ]);
  });

  it('writes nothing and logs when more than one note shares the title (CAP-4, I16)', async () => {
    const h = harness([task('td-1', 'fix the bug')]);
    h.vault.seed(EXISTING, TYPED_NOTE);
    h.vault.seed(`Projecten/${PROJECT}/taken/42-fix-the-bug.md`, TYPED_NOTE);

    const result = await h.action.invoke(PROJECT, SYNCED_AT);

    expect(h.vault.created).toEqual([]);
    expect(result.captured).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('links a remote task whose normalised title matches one existing note, despite casing and punctuation (CAP-4, I16)', async () => {
    const notePath = `Projecten/${PROJECT}/taken/fix-the-login-bug.md`;
    const h = harness([task('td-1', 'Fix the Login Bug!')]);
    h.vault.seed(notePath, TYPED_NOTE);
    h.syncState.seed(entityRecord({ id: 'entity-login', notePath }));

    await h.action.invoke(PROJECT, SYNCED_AT);

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.handleOf('entity-login', 'td')).toBe('td-1');
  });
});
