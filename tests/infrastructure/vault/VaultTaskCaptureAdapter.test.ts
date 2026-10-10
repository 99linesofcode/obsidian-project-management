import { describe, expect, it } from 'vitest';
import { CanonicalTask } from '../../../src/core/application/data/CanonicalTask.js';
import { VaultTaskCaptureAdapter } from '../../../src/infrastructure/vault/VaultTaskCaptureAdapter.js';
import { CreateTaskNoteAction } from '../../../src/core/application/actions/create-task-note/CreateTaskNoteAction.js';
import { splitFrontmatter } from '../../../src/core/domain/splitFrontmatter.js';
import type { NoteEnumeratorPort } from '../../../src/core/port/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../../../src/core/port/NoteReaderPort.js';
import type { NoteWriterPort } from '../../../src/core/port/NoteWriterPort.js';
import type { VaultEventPort } from '../../../src/core/port/VaultEventPort.js';
import { entityRecord } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

class FakeVault
  implements NoteReaderPort, NoteWriterPort, NoteEnumeratorPort, VaultEventPort
{
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  async writeNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  async moveFolder(): Promise<void> {}
  async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }
  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  async modifiedTime(): Promise<string | null> {
    return null;
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

function task(handle: string, title: string): CanonicalTask {
  return new CanonicalTask({
    handle,
    entityId: handle,
    title,
    body: '',
    status: 'Building',
    completed: false,
    parent: null,
    labels: [],
  });
}

function harness(): {
  adapter: VaultTaskCaptureAdapter;
  vault: FakeVault;
  syncState: FakeSyncState;
} {
  const vault = new FakeVault();
  const syncState = new FakeSyncState();
  const createTaskNote = new CreateTaskNoteAction(vault, syncState, '');
  return {
    adapter: new VaultTaskCaptureAdapter(
      vault,
      syncState,
      createTaskNote,
      (application) => application === 'github',
    ),
    vault,
    syncState,
  };
}

const SYNCED_AT = '2026-10-08T12:00:00Z';

describe('VaultTaskCaptureAdapter — adopting a captured task', () => {
  it('writes a code-host task as a task note carrying its url', async () => {
    const h = harness();
    const url = 'https://github.com/acme/widgets/issues/42';

    await h.adapter.adopt({
      task: task(url, 'Fix the Bug'),
      application: 'github',
      slug: 'github',
      projectName: 'Acme Widgets',
      syncedAt: SYNCED_AT,
    });

    expect(h.vault.created).toHaveLength(1);
    expect(h.vault.created[0]!.path).toBe(
      'Projecten/Acme Widgets/taken/fix-the-bug.md',
    );
    const record = h.syncState.setCalls[0]!;
    expect(h.syncState.handleOf(record.id, 'github')).toBe(url);
  });

  it('writes a task-manager task as a draft note and stamps its mirror', async () => {
    const h = harness();

    await h.adapter.adopt({
      task: task('T1', 'Buy Milk'),
      application: 'todoist',
      slug: 'todoist',
      projectName: 'Acme Widgets',
      syncedAt: SYNCED_AT,
    });

    expect(h.vault.created).toHaveLength(1);
    const { path, content } = h.vault.created[0]!;
    expect(path).toBe('Projecten/Acme Widgets/taken/buy-milk.md');
    const fields = splitFrontmatter(content)?.fields;
    expect(fields?.get('status')).toBe('Building');
    expect(content).not.toContain('url:');
    const record = h.syncState.setCalls[0]!;
    expect(h.syncState.handleOf(record.id, 'todoist')).toBe('T1');
  });

  it('refuses a task whose handle is empty', async () => {
    const h = harness();

    await expect(
      h.adapter.adopt({
        task: task('', 'Nameless'),
        application: 'todoist',
        slug: 'todoist',
        projectName: 'Acme Widgets',
        syncedAt: SYNCED_AT,
      }),
    ).rejects.toThrow('empty handle');

    expect(h.vault.created).toEqual([]);
    expect(h.syncState.setCalls).toEqual([]);
  });

  it('lists the handles already adopted for a connection', async () => {
    const h = harness();
    h.syncState.seed(
      entityRecord({
        id: 'entity-1',
        notePath: 'Projecten/Acme Widgets/taken/fix-the-bug.md',
      }),
      { github: { handle: 'https://github.com/acme/widgets/issues/42' } },
    );

    expect(await h.adapter.listAdopted('Acme Widgets', 'github')).toEqual([
      'https://github.com/acme/widgets/issues/42',
    ]);
  });
});
