import { describe, expect, it } from 'vitest';
import { DetectNoteRenamesAction } from '../../src/sync/DetectNoteRenamesAction.js';
import type { VaultPort } from '../../src/vault/VaultPort.js';
import { entityRecord, taskData } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  folders = new Map<string, string[]>();

  async getNoteByPath(): Promise<{ content: string } | null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const action = new DetectNoteRenamesAction(vault, syncState);
  return { action, vault, syncState };
}

const syncedAt = '2026-09-18T12:00:00Z';
const oldPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const newPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';

describe('REN-1 — a rename while Obsidian runs keeps identity', () => {
  it('pairs a vanished-path record with a same-stem note, mirrors intact', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }), {
      github: {
        handle: 'https://github.com/acme/widgets/issues/42',
        base: taskData({ id: 'uuid-1', notePath: oldPath, status: 'Building' }),
      },
    });
    h.vault.folders.set('Projecten/Acme Widgets/taken', [newPath]);

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    const record = await h.syncState.get('uuid-1');
    expect(record?.notePath).toBe(newPath);
    expect(h.syncState.handleOf('uuid-1', 'github')).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
  });

  it('pairs a to-do record whose note was renamed', async () => {
    const h = harness();
    const oldTodo = 'Projecten/Acme Widgets/todos/42-ship-it.md';
    const newTodo = 'Projecten/Acme Widgets/todos/ship-it.md';
    h.syncState.seed(entityRecord({ id: 'todo-uuid', notePath: oldTodo }), {
      todoist: { handle: 'T9' },
    });
    h.vault.folders.set('Projecten/Acme Widgets/todos', [newTodo]);

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect((await h.syncState.get('todo-uuid'))?.notePath).toBe(newTodo);
  });

  it('leaves a record whose note still exists alone', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: newPath }));
    h.vault.folders.set('Projecten/Acme Widgets/taken', [newPath]);

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect(h.syncState.setCalls).toEqual([]);
  });

  it('leaves a record whose note is gone and has no stem match alone', async () => {
    const h = harness();
    h.syncState.seed(entityRecord({ id: 'uuid-1', notePath: oldPath }));
    h.vault.folders.set('Projecten/Acme Widgets/taken', [
      'Projecten/Acme Widgets/taken/99-other.md',
    ]);

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect(h.syncState.setCalls).toEqual([]);
  });

  it('pairs each vanished record to its own same-stem note', async () => {
    const h = harness();
    const oldA = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
    const newA = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
    const oldB = 'Projecten/Acme Widgets/taken/43-ship-it.md';
    const newB = 'Projecten/Acme Widgets/taken/ship-it.md';
    h.syncState.seed(entityRecord({ id: 'uuid-a', notePath: oldA }));
    h.syncState.seed(entityRecord({ id: 'uuid-b', notePath: oldB }));
    h.vault.folders.set('Projecten/Acme Widgets/taken', [newA, newB]);

    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    expect((await h.syncState.get('uuid-a'))?.notePath).toBe(newA);
    expect((await h.syncState.get('uuid-b'))?.notePath).toBe(newB);
  });
});
