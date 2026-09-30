import { describe, expect, it } from 'vitest';
import { DetectNoteRenamesAction } from '../../../src/Domain/Actions/DetectNoteRenamesAction.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { entityRecord, mirror, taskData } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

class FakeVault implements VaultPort {
  folders = new Map<string, string[]>();
  notes = new Map<string, string>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
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

function noteWithId(id: string): string {
  return ['---', `id: ${id}`, 'status: Building', '---', 'Body.'].join('\n');
}

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const action = new DetectNoteRenamesAction(vault, syncState);
  return { action, vault, syncState };
}

const syncedAt = '2026-09-18T12:00:00Z';
const oldPath = 'Projecten/Acme Widgets/taken/42-old.md';
const newPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';

describe('DetectNoteRenamesAction', () => {
  it('updates the record notePath for a renamed task, without touching mirrors', async () => {
    // Given — a record at the old path and its note (same id) at a new path
    const h = harness();
    const base = taskData({ id: 'uuid-1', notePath: oldPath, status: 'Building' });
    h.syncState.records.set(
      'uuid-1',
      entityRecord({
        id: 'uuid-1',
        notePath: oldPath,
        mirrors: { github: mirror('https://github.com/acme/widgets/issues/42', base) },
      }),
    );
    h.vault.folders.set('Projecten/Acme Widgets/taken', [newPath]);
    h.vault.notes.set(newPath, noteWithId('uuid-1'));

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the record follows the id to the new path; its mirrors are intact
    const record = await h.syncState.get('uuid-1');
    expect(record?.notePath).toBe(newPath);
    expect(record?.mirrors.github?.handle).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
    expect(record?.mirrors.github?.base).toBe(base);
  });

  it('updates a to-do record whose note was renamed', async () => {
    // Given — a to-do record at the old path and its note at a new path
    const h = harness();
    const todoPath = 'Projecten/Acme Widgets/todos/ship-it.md';
    const newTodoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
    h.syncState.records.set(
      'todo-uuid',
      entityRecord({
        id: 'todo-uuid',
        notePath: todoPath,
        mirrors: { todoist: mirror('T9', null) },
      }),
    );
    h.vault.folders.set('Projecten/Acme Widgets/todos', [newTodoPath]);
    h.vault.notes.set(newTodoPath, noteWithId('todo-uuid'));

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the record follows the id
    expect((await h.syncState.get('todo-uuid'))?.notePath).toBe(newTodoPath);
  });

  it('leaves a record whose note still exists alone', async () => {
    // Given — a record whose note is present at its recorded path
    const h = harness();
    h.syncState.records.set(
      'uuid-1',
      entityRecord({ id: 'uuid-1', notePath: newPath, mirrors: {} }),
    );
    h.vault.folders.set('Projecten/Acme Widgets/taken', [newPath]);
    h.vault.notes.set(newPath, noteWithId('uuid-1'));

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — nothing moves and nothing is written
    expect(h.syncState.setCalls).toEqual([]);
  });

  it('leaves a record whose note is gone and has no id match alone', async () => {
    // Given — a record whose note is gone and no current note carries its id
    const h = harness();
    h.syncState.records.set(
      'uuid-1',
      entityRecord({ id: 'uuid-1', notePath: oldPath, mirrors: {} }),
    );
    h.vault.folders.set('Projecten/Acme Widgets/taken', [
      'Projecten/Acme Widgets/taken/99-other.md',
    ]);
    h.vault.notes.set(
      'Projecten/Acme Widgets/taken/99-other.md',
      noteWithId('uuid-99'),
    );

    // When — drift is detected
    await h.action.execute({ projectName: 'Acme Widgets', syncedAt });

    // Then — the deletion sweep owns it, not the rename detector
    expect(h.syncState.setCalls).toEqual([]);
  });
});
