import { describe, expect, it } from 'vitest';
import { stampFrontmatterField } from '../../src/vault/stampFrontmatterField.js';
import type { VaultPort } from '../../src/vault/VaultPort.js';

// A vault fake that records writes, so the stamp's single decision (fill in
// place, append, or leave alone) is observable.
class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  written: Array<{ path: string; content: string }> = [];

  async getNoteByPath(): Promise<never> {
    throw new Error('not used in this test');
  }

  async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.written.push({ path, content });
  }

  async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async moveFolder(): Promise<void> {}

  async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

describe('DISC-2 — a frontmatter field is stamped in place', () => {
  it('fills a declared field in place', async () => {
    const vault = new FakeVault();
    const content = ['---', 'status: open', 'todoist:', '---', 'Body.'].join(
      '\n',
    );

    await stampFrontmatterField(vault, 'note.md', content, 'todoist', 'T1');

    expect(vault.written).toEqual([
      {
        path: 'note.md',
        content: ['---', 'status: open', 'todoist: T1', '---', 'Body.'].join(
          '\n',
        ),
      },
    ]);
  });

  it('appends a field the frontmatter does not declare', async () => {
    const vault = new FakeVault();
    const content = ['---', 'status: open', '---', 'Body.'].join('\n');

    await stampFrontmatterField(vault, 'note.md', content, 'todoist', 'T1');

    expect(vault.written).toEqual([
      {
        path: 'note.md',
        content: ['---', 'status: open', 'todoist: T1', '---', 'Body.'].join(
          '\n',
        ),
      },
    ]);
  });

  it('leaves a note without frontmatter untouched', async () => {
    const vault = new FakeVault();

    await stampFrontmatterField(
      vault,
      'note.md',
      'Just a note.',
      'todoist',
      'T1',
    );

    expect(vault.written).toEqual([]);
  });
});
