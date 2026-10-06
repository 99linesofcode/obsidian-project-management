import { describe, expect, it } from 'vitest';
import { CleanupNoteFrontmatterAction } from '../../src/sync/CleanupNoteFrontmatterAction.js';
import { splitFrontmatter } from '../../src/vault/splitFrontmatter.js';
import type { VaultPort } from '../../src/vault/VaultPort.js';

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

describe('DISC-2 — the home note frontmatter is cleaned once', () => {
  it('strips a legacy id and url from a task note', async () => {
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

    await action.execute({ projectName: 'Acme Widgets' });

    const parsed = splitFrontmatter(vault.notes.get(takenPath) ?? '');
    expect(parsed?.fields.has('id')).toBe(false);
    expect(parsed?.fields.has('url')).toBe(false);
    expect(parsed?.fields.get('status')).toBe('open');
    expect(parsed?.body).toBe('Body text.');
  });

  it('strips the machine-id fields from a to-do note too', async () => {
    const vault = new FakeVault();
    vault.notes.set(
      todoPath,
      noteWith(['id: legacy-uuid', 'status: open']),
    );
    vault.folderNotes = folderWith([todoPath]);
    const action = makeAction(vault);

    await action.execute({ projectName: 'Acme Widgets' });

    expect(
      splitFrontmatter(vault.notes.get(todoPath) ?? '')?.fields.has('id'),
    ).toBe(false);
  });

  it('strips the dead todoist anchor from a task note', async () => {
    const vault = new FakeVault();
    vault.notes.set(
      takenPath,
      noteWith(['id: legacy-uuid', 'todoist: T1', 'status: open']),
    );
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);

    await action.execute({ projectName: 'Acme Widgets' });

    const parsed = splitFrontmatter(vault.notes.get(takenPath) ?? '');
    expect(parsed?.fields.has('todoist')).toBe(false);
    expect(parsed?.fields.has('id')).toBe(false);
    expect(parsed?.fields.get('status')).toBe('open');
    expect(parsed?.body).toBe('Body text.');

    const writesAfterFirst = vault.writes.length;
    await action.execute({ projectName: 'Acme Widgets' });
    expect(vault.writes).toHaveLength(writesAfterFirst);
  });

  it("leaves a project note's live todoist anchor untouched", async () => {
    const vault = new FakeVault();
    const projectPath = 'Projecten/Acme Widgets/_home.md';
    vault.notes.set(projectPath, noteWith(['pm: github', 'todoist: P1']));
    vault.folderNotes = folderWith([]);
    const action = makeAction(vault);

    await action.execute({ projectName: 'Acme Widgets' });

    expect(vault.writes).toEqual([]);
    expect(vault.notes.get(projectPath)).toContain('todoist: P1');
  });

  it('leaves a note with neither field untouched', async () => {
    const vault = new FakeVault();
    vault.notes.set(takenPath, noteWith(['status: open']));
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);

    await action.execute({ projectName: 'Acme Widgets' });

    expect(vault.writes).toEqual([]);
  });

  it('skips a note that fails to parse', async () => {
    const vault = new FakeVault();
    vault.notes.set(takenPath, 'no frontmatter here');
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);

    await action.execute({ projectName: 'Acme Widgets' });

    expect(vault.writes).toEqual([]);
    expect(vault.notes.get(takenPath)).toBe('no frontmatter here');
  });

  it('is idempotent: a second run writes nothing', async () => {
    const vault = new FakeVault();
    vault.notes.set(
      takenPath,
      noteWith(['id: legacy-uuid', 'url: https://example.com/42']),
    );
    vault.folderNotes = folderWith([takenPath]);
    const action = makeAction(vault);
    await action.execute({ projectName: 'Acme Widgets' });
    const writesAfterFirst = vault.writes.length;

    await action.execute({ projectName: 'Acme Widgets' });

    expect(vault.writes).toHaveLength(writesAfterFirst);
  });
});
