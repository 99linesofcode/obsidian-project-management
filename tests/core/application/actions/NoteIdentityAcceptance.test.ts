import { describe, expect, it } from 'vitest';
import { CreateTaskNoteAction } from '../../../../src/core/application/actions/create-task-note/CreateTaskNoteAction.js';
import { DetectNoteRenamesAction } from '../../../../src/core/application/actions/DetectNoteRenamesAction.js';
import { MigrateNoteIdsAction } from '../../../../src/core/application/actions/MigrateNoteIdsAction.js';
import { SweepDeletedNotesAction } from '../../../../src/core/application/actions/SweepDeletedNotesAction.js';
import type { HandleDeletedNoteAction } from '../../../../src/core/application/actions/HandleDeletedNoteAction.js';
import { noteId } from '../../../../src/core/domain/noteIdentity.js';
import type { VaultPort } from '../../../../src/core/port/VaultPort.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

// The end-to-end identity round trip the S31 delta exists to protect. A note
// created through the real creation action must carry the same id the ledger
// registered, so a later move re-pairs the record (IDN-3) instead of reading
// as a deletion (IDN-5) and destroying the mirror item.
class FakeVault implements VaultPort {
  readonly notes = new Map<string, string>();

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }

  async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content === undefined) {
      return;
    }
    this.notes.delete(oldPath);
    this.notes.set(newPath, content);
  }

  async trashNote(): Promise<void> {}

  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }

  async readNoteIds(): Promise<readonly { id: string; path: string }[]> {
    const ids: Array<{ id: string; path: string }> = [];
    for (const [path, content] of this.notes) {
      const id = noteId(content);
      if (id !== null) {
        ids.push({ id, path });
      }
    }
    return ids;
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}

  observe(): never {
    throw new Error('not used in this test');
  }

  readTask(): never {
    throw new Error('not used in this test');
  }

  applyField(): never {
    throw new Error('not used in this test');
  }

  readConnections(): never {
    throw new Error('not used in this test');
  }

  listEntities(): never {
    throw new Error('not used in this test');
  }

  observeProject(): never {
    throw new Error('not used in this test');
  }

  applyProjectArchived(): never {
    throw new Error('not used in this test');
  }
}

const PROJECT_NAME = 'Acme Widgets';
const PROJECT_ID = 'project-uuid-1';
const SYNCED_AT = '2026-10-28T12:00:00Z';
const CREATED_PATH = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const MOVED_PATH = 'Projecten/Acme Widgets/taken/renamed-elsewhere.md';

const githubConnection = {
  slug: 'github',
  application: 'github',
  target: 'https://github.com/acme/widgets',
};

function harness() {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const deleted: string[] = [];
  const handleDeleted = {
    execute: async (input: { notePath: string }) => {
      deleted.push(input.notePath);
    },
  } as unknown as HandleDeletedNoteAction;

  return {
    vault,
    syncState,
    deleted,
    create: new CreateTaskNoteAction(vault, syncState, ''),
    migrate: new MigrateNoteIdsAction(vault, syncState),
    detect: new DetectNoteRenamesAction(vault, syncState),
    sweep: new SweepDeletedNotesAction(vault, syncState, handleDeleted),
  };
}

describe('S31 note identity — the ledger and the note share one id', () => {
  it('stamps the registered id on the note, re-pairs a move and spares the sweep', async () => {
    const h = harness();

    await h.create.execute({
      url: '',
      title: 'Fix the bug',
      body: 'Body text',
      type: 'task',
      projectName: PROJECT_NAME,
      projectId: PROJECT_ID,
      connectionSlug: githubConnection.slug,
      syncedAt: SYNCED_AT,
      statusName: 'Building',
    });

    await h.migrate.execute({ projectName: PROJECT_NAME });

    const record = await h.syncState.findByNotePath(CREATED_PATH);
    expect(record).not.toBeNull();
    const entityId = record!.id;

    expect(noteId(h.vault.notes.get(CREATED_PATH) ?? '')).toBe(entityId);

    await h.vault.renameNote(CREATED_PATH, MOVED_PATH);

    await h.detect.execute({ projectId: PROJECT_ID, syncedAt: SYNCED_AT });
    expect((await h.syncState.getEntity(entityId))?.notePath).toBe(MOVED_PATH);

    await h.sweep.execute({
      projectId: PROJECT_ID,
      projectName: PROJECT_NAME,
      connections: [githubConnection],
    });

    expect(h.deleted).toEqual([]);
    expect(await h.syncState.findTombstoneByNotePath(CREATED_PATH)).toBeNull();
    expect(await h.syncState.findTombstoneByNotePath(MOVED_PATH)).toBeNull();
  });
});
