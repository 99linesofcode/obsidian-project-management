import { describe, expect, it } from 'vitest';
import { CreateTaskNoteAction } from '../../src/core/CreateTaskNoteAction.js';
import { splitFrontmatter } from '../../src/vault/splitFrontmatter.js';
import type { NoteEnumeratorPort } from '../../src/core/ports/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../../src/core/ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../../src/core/ports/NoteWriterPort.js';
import type { VaultEventPort } from '../../src/core/ports/VaultEventPort.js';
import { entityRecord } from '../helpers/records.js';
import { FakeSyncState } from '../helpers/fakeSyncState.js';

class FakeVault
  implements
    NoteReaderPort,
    NoteWriterPort,
    NoteEnumeratorPort,
    VaultEventPort
{
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
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
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

const url = 'https://github.com/acme/widgets/issues/42';
const templatePath = 'Templates/Task.md';

const template = [
  '---',
  'affiliation: []',
  'id:',
  'type:',
  'status:',
  'synced:',
  'created: {{date}}',
  'categories:',
  '  - "[[Tasks.base|Tasks]]"',
  'tags: []',
  '---',
].join('\n');

function input() {
  return {
    url,
    title: 'Fix the Bug!',
    body: 'The bug happens when the widget is resized.',
    type: 'task',
    projectName: 'Acme Widgets',
    connectionSlug: 'github',
    syncedAt: '2026-09-18T12:00:00Z',
    statusName: 'Building',
  };
}

describe('MAT-5 — a note filename is a human-readable slug', () => {
  it('creates a slug-named note carrying id, type and status, no url', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    await action.execute(input());

    expect(vault.created).toHaveLength(1);
    const { path, content } = vault.created[0]!;
    expect(path).toBe('Projecten/Acme Widgets/taken/fix-the-bug.md');
    const fields = splitFrontmatter(content)?.fields;
    expect(fields?.get('id')).toBeUndefined();
    expect(fields?.get('type')).toBe('task');
    expect(fields?.get('status')).toBe('Building');
    expect(content).not.toContain('url:');
    expect(syncState.setCalls).toHaveLength(1);
    const record = syncState.setCalls[0]!;
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.notePath).toBe(path);
    expect(syncState.handleOf(record.id, 'github')).toBe(url);
  });

  it('renders the note from the vault template', async () => {
    const vault = new FakeVault();
    vault.notes.set(templatePath, template);
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    await action.execute(input());

    expect(vault.created).toHaveLength(1);
    const content = vault.created[0]!.content;
    expect(content).toContain('type: task');
    expect(content).toContain('status: Building');
    expect(content).toContain('created: 2026-09-18');
    expect(content).toContain('  - "[[Tasks.base|Tasks]]"');
  });

  it('falls back to the built-in frontmatter when the template is missing', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    await action.execute(input());

    expect(vault.created[0]!.content).toContain('categories: [taken]');
  });

  it('is a no-op when the issue is already registered', async () => {
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.seed(
      entityRecord({
        id: 'existing-uuid',
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      }),
      { github: { handle: url } },
    );
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    await action.execute(input());

    expect(vault.created).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });
});
