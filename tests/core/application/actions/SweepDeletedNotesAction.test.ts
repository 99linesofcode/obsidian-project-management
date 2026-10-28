import { describe, expect, it } from 'vitest';
import { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';
import { entityRecord } from '../../../helpers/records.js';
import type { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

const githubConnection = {
  slug: 'github',
  application: 'github',
  target: 'https://github.com/acme/widgets',
};

const todoistConnection = {
  slug: 'todoist',
  application: 'todoist',
  target: 'P1',
};

class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  noteIds: ReadonlyArray<{ id: string; path: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async readNoteIds(): Promise<
    readonly { id: string; path: string }[]
  > {
    return this.noteIds;
  }
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const deleted: string[] = [];
  const calls: Array<{
    notePath: string;
    connections: ReadonlyArray<{ slug: string }>;
  }> = [];
  let fail = false;
  const handleDeleted = {
    execute: async (input: {
      notePath: string;
      connections: ReadonlyArray<{ slug: string }>;
    }) => {
      if (fail) {
        throw new Error('delete failed');
      }
      deleted.push(input.notePath);
      calls.push({ notePath: input.notePath, connections: input.connections });
    },
  } as unknown as HandleDeletedNoteAction;
  const action = new SweepDeletedNotesAction(vault, syncState, handleDeleted);
  return {
    action,
    vault,
    syncState,
    deleted,
    calls,
    failNext: () => {
      fail = true;
    },
  };
}

describe('DEL-4 — the sweep records a tombstone for a gone tracked note', () => {
  it('records a tombstone for a registry record whose note is gone', async () => {
    const h = harness();
    const notePath = 'Projecten/Acme Widgets/taken/42-gone.md';
    h.syncState.seed(entityRecord({ id: 'entity-1', notePath }), {
      github: { handle: 'GH-42' },
    });

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connections: [githubConnection],
    });

    expect(await h.syncState.findTombstoneByNotePath(notePath)).toMatchObject({
      entityId: 'entity-1',
      notePath,
    });
    expect(await h.syncState.findTombstone('GH-42')).not.toBeNull();
  });

  it('leaves a record whose note still exists alone', async () => {
    const h = harness();
    const notePath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
    h.syncState.seed(entityRecord({ id: 'entity-1', notePath }), {
      github: { handle: 'GH-42' },
    });
    h.vault.notes.set(notePath, 'content');

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connections: [githubConnection],
    });

    expect(await h.syncState.findTombstoneByNotePath(notePath)).toBeNull();
    expect(h.deleted).toEqual([]);
  });

  it('never sweeps a record relocated under Archief', async () => {
    const h = harness();
    const notePath = 'Archief/Acme Widgets/taken/42-gone.md';
    h.syncState.seed(entityRecord({ id: 'entity-1', notePath }), {
      github: { handle: 'GH-42' },
    });

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connections: [githubConnection],
    });

    expect(await h.syncState.findTombstoneByNotePath(notePath)).toBeNull();
    expect(h.deleted).toEqual([]);
  });

  it('logs a failed tombstone write and continues with the rest', async () => {
    const h = harness();
    const first = 'Projecten/Acme Widgets/taken/42-first.md';
    const second = 'Projecten/Acme Widgets/taken/43-second.md';
    h.syncState.seed(entityRecord({ id: 'entity-1', notePath: first }), {
      github: { handle: 'GH-1' },
    });
    h.syncState.seed(entityRecord({ id: 'entity-2', notePath: second }), {
      github: { handle: 'GH-2' },
    });
    h.syncState.failTombstoneWrites = 1;

    await expect(
      h.action.execute({
        projectId: 'Acme Widgets',
        projectName: 'Acme Widgets',
        connections: [githubConnection],
      }),
    ).resolves.toBeUndefined();

    expect(await h.syncState.findTombstoneByNotePath(second)).not.toBeNull();
  });

  it('hands every connection to the deletion handler once per gone note (SHELL-3)', async () => {
    const h = harness();
    const notePath = 'Projecten/Acme Widgets/taken/42-gone.md';
    h.syncState.seed(entityRecord({ id: 'entity-1', notePath }), {
      github: { handle: 'GH-42' },
      todoist: { handle: 'T1' },
    });
    const connections = [todoistConnection, githubConnection];

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connections,
    });

    expect(h.calls).toEqual([{ notePath, connections }]);
  });
});

describe('DEL-2 — the tombstone and record are pruned once every side has settled', () => {
  it('prunes a settled tombstone and its registry record', async () => {
    const h = harness();
    const notePath = 'Projecten/Acme Widgets/taken/42-gone.md';
    h.syncState.records.set(
      'entity-1',
      entityRecord({ id: 'entity-1', notePath }),
    );
    await h.syncState.recordTombstone({
      entityId: 'entity-1',
      notePath,
      deletedAt: '2026-10-13T00:00:00Z',
      handle: 'GH-42',
    });

    await h.action.execute({
      projectId: 'Acme Widgets',
      projectName: 'Acme Widgets',
      connections: [githubConnection],
    });

    expect(await h.syncState.findTombstoneByNotePath(notePath)).toBeNull();
    expect(await h.syncState.findByNotePath(notePath)).toBeNull();
  });
});
