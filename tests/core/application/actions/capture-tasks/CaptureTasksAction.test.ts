import { describe, expect, it } from 'vitest';
import { CaptureTasksAction } from '../../../../../src/core/application/actions/capture-tasks/CaptureTasksAction.js';
import { CreateTaskNoteAction } from '../../../../../src/core/application/actions/create-task-note/CreateTaskNoteAction.js';
import { CanonicalTask } from '../../../../../src/core/port/data/CanonicalTask.js';
import { ConnectionDataTransferObject } from '../../../../../src/core/port/data/ConnectionDataTransferObject.js';
import type { MirrorPort } from '../../../../../src/core/port/MirrorPort.js';
import type { MirrorAdapterFactoryPort } from '../../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { FakeVault as FakeVaultBase } from '../../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../../helpers/fakeSyncState.js';
import { entityRecord } from '../../../../helpers/records.js';

const SYNCED_AT = '2026-10-08T12:00:00Z';

class FakeVault extends FakeVaultBase {
  readonly created: Array<{ path: string; content: string }> = [];
  failOn: string | null = null;
  private readonly notes = new Map<string, string>();

  constructor(
    private readonly connections: readonly ConnectionDataTransferObject[] = [
      connection('acme', 'T1', 'acme'),
    ],
  ) {
    super();
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
    if (this.failOn !== null && path.endsWith(`/${this.failOn}.md`)) {
      throw new Error(`create failed: ${path}`);
    }
    this.notes.set(path, content);
    this.created.push({ path, content });
  }
}

function task(handle: string): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: handle,
    title: handle,
    body: '',
    status: '',
    completed: false,
    parent: null,
    labels: [],
  });
}

function subtask(handle: string, parent: string): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: handle,
    title: handle,
    body: '',
    status: '',
    completed: false,
    parent,
    labels: [],
  });
}

function labelledTask(
  handle: string,
  title: string,
  labels: readonly string[],
): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: handle,
    title,
    body: '',
    status: '',
    completed: false,
    parent: null,
    labels,
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
    connection('acme', 'T1', 'acme'),
  ],
): {
  action: CaptureTasksAction;
  vault: FakeVault;
  syncState: FakeSyncState;
  listing: { tasks: CanonicalTask[] };
} {
  const vault = new FakeVault(connections);
  const syncState = new FakeSyncState();
  const createTaskNote = new CreateTaskNoteAction(vault, syncState, '');
  const listing = { tasks };
  const factory: MirrorAdapterFactoryPort = {
    create: () => registered({ capture: async () => listing.tasks }),
  };
  return {
    action: new CaptureTasksAction(
      vault,
      factory,
      syncState,
      createTaskNote,
      (application) => application === 'github',
    ),
    vault,
    syncState,
    listing,
  };
}

function noteAt(
  vault: FakeVault,
  slug: string,
): { path: string; content: string } {
  return vault.created.find((note) => note.path.endsWith(`/${slug}.md`))!;
}

describe('CaptureTasksAction — adopting tracked tasks (CAP-2)', () => {
  it('adopts a mirror-born task exactly once (CAP-2)', async () => {
    const h = harness([task('A')]);

    const first = await h.action.invoke('Acme', SYNCED_AT);
    const second = await h.action.invoke('Acme', SYNCED_AT);

    expect(first.captured).toEqual(['A']);
    expect(second.captured).toEqual([]);
    expect(h.vault.created.map((note) => note.path)).toEqual([
      'Projecten/Acme/taken/a.md',
    ]);
  });

  it('adopts a task ordered before a previously adopted one (CAP-2)', async () => {
    const h = harness([task('A')]);
    await h.action.invoke('Acme', SYNCED_AT);
    h.listing.tasks = [task('N'), task('A')];

    const result = await h.action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual(['N']);
    expect(h.vault.created.map((note) => note.path)).toEqual([
      'Projecten/Acme/taken/a.md',
      'Projecten/Acme/taken/n.md',
    ]);
  });

  it('skips a task the vault already declares (CAP-2)', async () => {
    const h = harness([task('A')]);
    h.syncState.seed(
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme/taken/a.md',
      }),
      { acme: { handle: 'A' } },
    );

    const result = await h.action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual([]);
    expect(h.vault.created).toEqual([]);
  });

  it('does not lose the remaining tasks when one adoption fails (CAP-2)', async () => {
    const h = harness([task('A'), task('B'), task('C')]);
    h.vault.failOn = 'b';

    const first = await h.action.invoke('Acme', SYNCED_AT);
    h.vault.failOn = null;
    const second = await h.action.invoke('Acme', SYNCED_AT);

    expect(first.captured).toEqual(['A']);
    expect(first.errors).toHaveLength(1);
    expect(second.captured).toEqual(['B', 'C']);
    expect(h.vault.created.map((note) => note.path)).toEqual([
      'Projecten/Acme/taken/a.md',
      'Projecten/Acme/taken/b.md',
      'Projecten/Acme/taken/c.md',
    ]);
  });

  it('skips a connection whose adapter declares no capture (CAP-2)', async () => {
    const vault = new FakeVault([connection('acme', 'T1', 'acme')]);
    const syncState = new FakeSyncState();
    const factory: MirrorAdapterFactoryPort = {
      create: () => ({}) as MirrorPort,
    };
    const action = new CaptureTasksAction(
      vault,
      factory,
      syncState,
      new CreateTaskNoteAction(vault, syncState, ''),
      () => false,
    );

    const result = await action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(vault.created).toEqual([]);
  });

  it('captures each connection independently (CAP-2)', async () => {
    const vault = new FakeVault([
      connection('acme', 'T1', 'acme'),
      connection('other', 'T2', 'other'),
    ]);
    const syncState = new FakeSyncState();
    const factory: MirrorAdapterFactoryPort = {
      create: (application) =>
        registered({
          capture: async () => [task(application === 'acme' ? 'A' : 'B')],
        }),
    };
    const action = new CaptureTasksAction(
      vault,
      factory,
      syncState,
      new CreateTaskNoteAction(vault, syncState, ''),
      () => false,
    );

    const result = await action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual(['A', 'B']);
    expect(vault.created.map((note) => note.path)).toEqual([
      'Projecten/Acme/taken/a.md',
      'Projecten/Acme/taken/b.md',
    ]);
  });

  it('isolates a connection whose listing fails and captures the rest (CAP-2)', async () => {
    const vault = new FakeVault([
      connection('acme', 'T1', 'acme'),
      connection('other', 'T2', 'other'),
    ]);
    const syncState = new FakeSyncState();
    const factory: MirrorAdapterFactoryPort = {
      create: (application) =>
        registered({
          capture: async () => {
            if (application === 'acme') {
              throw new Error('listing failed');
            }
            return [task('B')];
          },
        }),
    };
    const action = new CaptureTasksAction(
      vault,
      factory,
      syncState,
      new CreateTaskNoteAction(vault, syncState, ''),
      () => false,
    );

    const result = await action.invoke('Acme', SYNCED_AT);

    expect(result.captured).toEqual(['B']);
    expect(result.errors).toHaveLength(1);
    expect(vault.created.map((note) => note.path)).toEqual([
      'Projecten/Acme/taken/b.md',
    ]);
  });

  it('captures an unlabelled root task-manager task as a type:slice note (CAP-2, LBL-7)', async () => {
    const h = harness([task('A')], [connection('todoist', 'T1', 'td')]);

    await h.action.invoke('Acme', SYNCED_AT);

    expect(noteAt(h.vault, 'a').content).toContain('labels: [type:slice]');
  });

  it('captures an unlabelled subtask as a type:task note (CAP-2, LBL-7)', async () => {
    const h = harness([subtask('B', 'A')], [connection('todoist', 'T1', 'td')]);

    await h.action.invoke('Acme', SYNCED_AT);

    expect(noteAt(h.vault, 'b').content).toContain('labels: [type:task]');
  });

  it('keeps an explicit type label on a captured task-manager task (CAP-2, LBL-7)', async () => {
    const h = harness(
      [labelledTask('C', 'C', ['type:bug'])],
      [connection('todoist', 'T1', 'td')],
    );

    await h.action.invoke('Acme', SYNCED_AT);

    expect(noteAt(h.vault, 'c').content).toContain('labels: [type:bug]');
  });

  it('writes the note shape each capture gate dictates: the code host by label, the task manager typed by position (LBL-8)', async () => {
    const vault = new FakeVault([
      connection('github', 'R1', 'gh'),
      connection('todoist', 'P1', 'td'),
    ]);
    const syncState = new FakeSyncState();
    const factory: MirrorAdapterFactoryPort = {
      create: (application) =>
        registered({
          capture: async () =>
            application === 'github'
              ? [labelledTask('gh-1', 'Issue task', ['type:task'])]
              : [labelledTask('td-1', 'Remote task', [])],
        }),
    };
    const action = new CaptureTasksAction(
      vault,
      factory,
      syncState,
      new CreateTaskNoteAction(vault, syncState, ''),
      (application) => application === 'github',
    );

    await action.invoke('Acme', SYNCED_AT);

    const issueNote = noteAt(vault, 'issue-task');
    const remoteNote = noteAt(vault, 'remote-task');
    expect(issueNote.content).toContain('labels: [type:task]');
    expect(issueNote.content).not.toMatch(/^type:/m);
    expect(remoteNote.content).toContain('labels: [type:slice]');
    expect(remoteNote.content).not.toMatch(/^type:/m);
  });
});
