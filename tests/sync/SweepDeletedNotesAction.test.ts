import { describe, expect, it } from 'vitest';
import { SweepDeletedNotesAction } from '../../src/sync/SweepDeletedNotesAction.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';
import { entityRecord } from '../helpers/records.js';
import type { HandleDeletedNoteAction } from '../../src/sync/HandleDeletedNoteAction.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';

class FakeVault {
  notes = new Map<string, string>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const deleted: string[] = [];
  let fail = false;
  const handleDeleted = {
    execute: async (input: { notePath: string }) => {
      if (fail) {
        throw new Error('delete failed');
      }
      deleted.push(input.notePath);
    },
  } as unknown as HandleDeletedNoteAction;
  const action = new SweepDeletedNotesAction(
    vault as unknown as VaultPort,
    syncState,
    handleDeleted,
  );
  return {
    action,
    vault,
    syncState,
    deleted,
    failNext: () => {
      fail = true;
    },
  };
}

describe('DEL-3 — a partial deletion retries to completion', () => {
  it('sweeps a registry record whose note is gone', async () => {
    const h = harness();
    h.syncState.records.set(
      'entity-1',
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme Widgets/taken/42-gone.md',
      }),
    );

    await h.action.execute({
      projectName: 'Acme Widgets',
      connectionSlug: 'github',
      application: 'github',
      target: 'https://github.com/acme/widgets',
    });

    expect(h.deleted).toEqual(['Projecten/Acme Widgets/taken/42-gone.md']);
  });

  it('leaves a record whose note still exists alone', async () => {
    const h = harness();
    h.syncState.records.set(
      'entity-1',
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      }),
    );
    h.vault.notes.set(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'content',
    );

    await h.action.execute({
      projectName: 'Acme Widgets',
      connectionSlug: 'github',
      application: 'github',
      target: 'https://github.com/acme/widgets',
    });

    expect(h.deleted).toEqual([]);
  });

  it('never sweeps a record relocated under Archief', async () => {
    const h = harness();
    h.syncState.records.set(
      'entity-1',
      entityRecord({
        id: 'entity-1',
        notePath: 'Archief/Acme Widgets/taken/42-gone.md',
      }),
    );

    await h.action.execute({
      projectName: 'Acme Widgets',
      connectionSlug: 'github',
      application: 'github',
      target: 'https://github.com/acme/widgets',
    });

    expect(h.deleted).toEqual([]);
  });

  it('logs a failed deletion and continues with the rest', async () => {
    const h = harness();
    h.syncState.records.set(
      'entity-1',
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme Widgets/taken/42-first.md',
      }),
    );
    h.failNext();

    await expect(
      h.action.execute({
        projectName: 'Acme Widgets',
        connectionSlug: 'github',
        application: 'github',
        target: 'https://github.com/acme/widgets',
      }),
    ).resolves.toBeUndefined();
    expect(h.deleted).toEqual([]);
  });
});
