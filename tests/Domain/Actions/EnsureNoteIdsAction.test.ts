import { describe, expect, it } from 'vitest';
import { EnsureNoteIdsAction } from '../../../src/Domain/Actions/EnsureNoteIdsAction.js';
import { VaultTaskMapper } from '../../../src/Domain/Mappers/VaultTaskMapper.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// A fake vault at the port: a path→content map plus a folder→paths listing, so
// the action's stamping decisions are what's under test.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  folderNotes = new Map<string, string[]>();
  writes: Array<{ path: string; content: string }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.writes.push({ path, content });
  }

  async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folderNotes.get(folder) ?? [];
  }

  async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async moveFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {
    throw new Error('not used in this test');
  }

  onNoteDeleted(): void {
    throw new Error('not used in this test');
  }

  onNoteRenamed(): void {
    throw new Error('not used in this test');
  }
}

const takenPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const todoPath = 'Projecten/Acme Widgets/todos/ship-it.md';

function noteWith(frontmatter: string[]): string {
  return ['---', ...frontmatter, '---', 'Body text.'].join('\n');
}

function folderWith(paths: string[]): Map<string, string[]> {
  return new Map<string, string[]>([
    ['Projecten/Acme Widgets/taken', paths.filter((p) => p === takenPath)],
    ['Projecten/Acme Widgets/todos', paths.filter((p) => p === todoPath)],
  ]);
}

describe('EnsureNoteIdsAction', () => {
  it('backfills a uuid into a note that has no id', async () => {
    // Given — a task note without an id field
    const vault = new FakeVault();
    vault.notes.set(takenPath, noteWith(['status: open']));
    vault.folderNotes = folderWith([takenPath]);
    const action = new EnsureNoteIdsAction(vault);

    // When — the action runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — the note carries a generated id and the rest is preserved
    const parsed = splitFrontmatter(vault.notes.get(takenPath) ?? '');
    const id = parsed?.fields.get('id') ?? '';
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed?.fields.get('status')).toBe('open');
    expect(parsed?.body).toBe('Body text.');
  });

  it('stamps to-do notes as well as task notes', async () => {
    // Given — one note in each folder, both missing an id
    const vault = new FakeVault();
    vault.notes.set(takenPath, noteWith(['status: open']));
    vault.notes.set(todoPath, noteWith(['status: open']));
    vault.folderNotes = folderWith([takenPath, todoPath]);
    const action = new EnsureNoteIdsAction(vault);

    // When — the action runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — both notes are stamped
    expect(
      splitFrontmatter(vault.notes.get(takenPath) ?? '')?.fields.has('id'),
    ).toBe(true);
    expect(
      splitFrontmatter(vault.notes.get(todoPath) ?? '')?.fields.has('id'),
    ).toBe(true);
  });

  it('leaves a note that already carries an id untouched', async () => {
    // Given — a note with an existing id
    const vault = new FakeVault();
    vault.notes.set(takenPath, noteWith(['id: existing-uuid', 'status: open']));
    vault.folderNotes = folderWith([takenPath]);
    const action = new EnsureNoteIdsAction(vault);

    // When — the action runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — nothing was written and the id is unchanged
    expect(vault.writes).toEqual([]);
    expect(
      splitFrontmatter(vault.notes.get(takenPath) ?? '')?.fields.get('id'),
    ).toBe('existing-uuid');
  });

  it('skips a note that fails to parse', async () => {
    // Given — a note without a frontmatter block
    const vault = new FakeVault();
    vault.notes.set(takenPath, 'no frontmatter here');
    vault.folderNotes = folderWith([takenPath]);
    const action = new EnsureNoteIdsAction(vault);

    // When — the action runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — the malformed note is left as-is
    expect(vault.writes).toEqual([]);
    expect(vault.notes.get(takenPath)).toBe('no frontmatter here');
  });

  it('is idempotent: a second run writes nothing', async () => {
    // Given — a note the first run already stamped
    const vault = new FakeVault();
    vault.notes.set(takenPath, noteWith(['status: open']));
    vault.folderNotes = folderWith([takenPath]);
    const action = new EnsureNoteIdsAction(vault);
    await action.execute({ projectName: 'Acme Widgets' });
    const firstId = splitFrontmatter(
      vault.notes.get(takenPath) ?? '',
    )?.fields.get('id');

    // When — the action runs again
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — no second write and the id is stable
    expect(vault.writes).toHaveLength(1);
    expect(
      splitFrontmatter(vault.notes.get(takenPath) ?? '')?.fields.get('id'),
    ).toBe(firstId);
  });

  it('backfills an id that the vault mapper then parses', async () => {
    // Given — a task note without an id
    const vault = new FakeVault();
    vault.notes.set(takenPath, noteWith(['status: Building']));
    vault.folderNotes = folderWith([takenPath]);
    const action = new EnsureNoteIdsAction(vault);

    // When — the backfill runs, then the note is parsed
    await action.execute({ projectName: 'Acme Widgets' });
    const task = VaultTaskMapper.parseTask(
      vault.notes.get(takenPath) ?? '',
      takenPath,
      { projectName: 'Acme Widgets', doneLane: 'Shipped' },
    );

    // Then — the stamped uuid is the parsed identity, so the registry can
    // resolve the note to its record
    const stamped = splitFrontmatter(
      vault.notes.get(takenPath) ?? '',
    )?.fields.get('id');
    expect(stamped).toMatch(/^[0-9a-f-]{36}$/);
    expect(task?.id).toBe(stamped);
    expect(task?.status).toBe('Building');
  });
});
