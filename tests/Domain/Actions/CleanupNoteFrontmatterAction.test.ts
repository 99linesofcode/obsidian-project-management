import { describe, expect, it } from 'vitest';
import { CleanupNoteFrontmatterAction } from '../../../src/Domain/Actions/CleanupNoteFrontmatterAction.js';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// A fake vault at the port: a path→content map plus a folder→paths listing, so
// the action's cleanup decisions are what's under test.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
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

function makeAction(vault: FakeVault) {
  return new CleanupNoteFrontmatterAction(vault);
}

describe('CleanupNoteFrontmatterAction', () => {
  it('strips a legacy id and url from a task note', async () => {
    // Given — a legacy note carrying both machine-id fields
    const vault = new FakeVault();
    vault.notes.set(
      takenPath,
      noteWith([
        'id: legacy-uuid',
        'url: https://github.com/acme/widgets/issues/42',
        'status: open',
      ]),
    );
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);

    // When — the cleanup runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — both fields are gone and the rest is preserved
    const parsed = splitFrontmatter(vault.notes.get(takenPath) ?? '');
    expect(parsed?.fields.has('id')).toBe(false);
    expect(parsed?.fields.has('url')).toBe(false);
    expect(parsed?.fields.get('status')).toBe('open');
    expect(parsed?.body).toBe('Body text.');
  });

  it('strips the machine-id fields from a to-do note too', async () => {
    // Given — a to-do note with a legacy id
    const vault = new FakeVault();
    vault.notes.set(
      todoPath,
      noteWith(['id: legacy-uuid', 'status: open']),
    );
    vault.folderNotes = folderWith([todoPath]);
    const action = makeAction(vault);

    // When — the cleanup runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — the id is gone
    expect(
      splitFrontmatter(vault.notes.get(todoPath) ?? '')?.fields.has('id'),
    ).toBe(false);
  });

  it('leaves a todoist anchor as-is', async () => {
    // Given — a note carrying a todoist anchor and a legacy id
    const vault = new FakeVault();
    vault.notes.set(
      takenPath,
      noteWith(['id: legacy-uuid', 'todoist: T1', 'status: open']),
    );
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);

    // When — the cleanup runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — the anchor survives; only the machine id is stripped
    const parsed = splitFrontmatter(vault.notes.get(takenPath) ?? '');
    expect(parsed?.fields.get('todoist')).toBe('T1');
    expect(parsed?.fields.has('id')).toBe(false);
  });

  it('leaves a note with neither field untouched', async () => {
    // Given — a clean note
    const vault = new FakeVault();
    vault.notes.set(takenPath, noteWith(['status: open']));
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);

    // When — the cleanup runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — nothing is written
    expect(vault.writes).toEqual([]);
  });

  it('skips a note that fails to parse', async () => {
    // Given — a note without a frontmatter block
    const vault = new FakeVault();
    vault.notes.set(takenPath, 'no frontmatter here');
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);

    // When — the cleanup runs
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — the malformed note is left as-is
    expect(vault.writes).toEqual([]);
    expect(vault.notes.get(takenPath)).toBe('no frontmatter here');
  });

  it('is idempotent: a second run writes nothing', async () => {
    // Given — a note the first run cleaned
    const vault = new FakeVault();
    vault.notes.set(
      takenPath,
      noteWith(['id: legacy-uuid', 'url: https://example.com/42']),
    );
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);
    await action.execute({ projectName: 'Acme Widgets' });
    const writesAfterFirst = vault.writes.length;

    // When — the cleanup runs again
    await action.execute({ projectName: 'Acme Widgets' });

    // Then — nothing further is written
    expect(vault.writes).toHaveLength(writesAfterFirst);
  });
});
