import { describe, expect, it } from 'vitest';
import { stampFrontmatterField } from '../../../src/Domain/Notes/stampFrontmatterField.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// A vault fake that records writes, so the stamp's single decision (fill in
// place, append, or leave alone) is observable.
class FakeVault implements VaultPort {
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

describe('stampFrontmatterField', () => {
  it('fills a declared field in place', async () => {
    // Given — a note whose frontmatter declares the field empty
    const vault = new FakeVault();
    const content = ['---', 'status: open', 'todoist:', '---', 'Body.'].join(
      '\n',
    );

    // When — the field is stamped
    await stampFrontmatterField(vault, 'note.md', content, 'todoist', 'T1');

    // Then — the field is filled and the rest is preserved
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
    // Given — a note whose frontmatter omits the field
    const vault = new FakeVault();
    const content = ['---', 'status: open', '---', 'Body.'].join('\n');

    // When — the field is stamped
    await stampFrontmatterField(vault, 'note.md', content, 'todoist', 'T1');

    // Then — the field is appended before the closing delimiter
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
    // Given — a plain note
    const vault = new FakeVault();

    // When — the field is stamped
    await stampFrontmatterField(
      vault,
      'note.md',
      'Just a note.',
      'todoist',
      'T1',
    );

    // Then — nothing is written
    expect(vault.written).toEqual([]);
  });
});
