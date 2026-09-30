import { describe, expect, it } from 'vitest';
import { CreateTaskNoteAction } from '../../../src/Domain/Actions/CreateTaskNoteAction.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';
import { entityRecord, mirror } from '../../helpers/records.js';
import { FakeSyncState } from '../../helpers/fakeSyncState.js';

// A fake vault at the port: a path→content map plus the create log, so the
// action's naming and rendering decisions are what's under test.
class FakeVault implements VaultPort {
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
    syncedAt: '2026-09-18T12:00:00Z',
    statusName: 'Building',
  };
}

describe('CreateTaskNoteAction', () => {
  it('creates a slug-named note carrying id, type and status, no url', async () => {
    // Given — a vault with no existing note and an empty registry
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action materialises the task note
    await action.execute(input());

    // Then — the note lands at the title slug
    expect(vault.created).toHaveLength(1);
    const { path, content } = vault.created[0]!;
    expect(path).toBe('Projecten/Acme Widgets/taken/fix-the-bug.md');
    // And — the frontmatter carries the vault-owned uuid, type and status
    const fields = splitFrontmatter(content)?.fields;
    expect(fields?.get('id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(fields?.get('type')).toBe('task');
    expect(fields?.get('status')).toBe('Building');
    expect(content).not.toContain('url:');
    // And — the registry record anchors the note by id with the github handle
    expect(syncState.setCalls).toHaveLength(1);
    const record = syncState.setCalls[0]!;
    expect(record.id).toBe(fields?.get('id'));
    expect(record.notePath).toBe(path);
    expect(record.mirrors.github?.handle).toBe(url);
  });

  it('renders the note from the vault template', async () => {
    // Given — a vault holding the task template
    const vault = new FakeVault();
    vault.notes.set(templatePath, template);
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action materialises the task note
    await action.execute(input());

    // Then — the rendered content keeps the template's vault-owned fields and
    // fills the sync fields
    expect(vault.created).toHaveLength(1);
    const content = vault.created[0]!.content;
    expect(content).toContain('type: task');
    expect(content).toContain('status: Building');
    expect(content).toContain('created: 2026-09-18');
    expect(content).toContain('  - "[[Tasks.base|Tasks]]"');
  });

  it('falls back to the built-in frontmatter when the template is missing', async () => {
    // Given — a vault without the template note
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action materialises the task note
    await action.execute(input());

    // Then — the built-in mapping is used
    expect(vault.created[0]!.content).toContain('categories: [taken]');
  });

  it('is a no-op when the issue is already registered', async () => {
    // Given — a registry that already tracks the issue
    const vault = new FakeVault();
    const syncState = new FakeSyncState();
    syncState.records.set(
      'existing-uuid',
      entityRecord({
        id: 'existing-uuid',
        notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
        mirrors: { github: mirror(url, null) },
      }),
    );
    const action = new CreateTaskNoteAction(vault, syncState, templatePath);

    // When — the action runs
    await action.execute(input());

    // Then — nothing is created and no new record is written
    expect(vault.created).toEqual([]);
    expect(syncState.setCalls).toEqual([]);
  });
});
