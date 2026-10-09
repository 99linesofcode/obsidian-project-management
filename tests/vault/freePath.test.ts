import { describe, expect, it } from 'vitest';
import { freePath } from '../../src/core/freePath.js';
import type { NoteEnumeratorPort } from '../../src/core/ports/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../../src/core/ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../../src/core/ports/NoteWriterPort.js';
import type { VaultEventPort } from '../../src/core/ports/VaultEventPort.js';

// A vault fake backed by a path set, so the collision walk is observable.
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
  notes = new Set<string>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    return this.notes.has(path) ? { content: '' } : null;
  }

  async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async writeNote(): Promise<never> {
    throw new Error('not used in this test');
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

describe('MAT-5 — a taken slug gains an ordinal', () => {
  it('returns the base path when it is free', async () => {
    const vault = new FakeVault();

    const path = await freePath(vault, 'Projecten/X/todos/fix-the-bug.md');

    expect(path).toBe('Projecten/X/todos/fix-the-bug.md');
  });

  it('suffixes -2 when the base path is taken', async () => {
    const vault = new FakeVault();
    vault.notes.add('Projecten/X/todos/fix-the-bug.md');

    const path = await freePath(vault, 'Projecten/X/todos/fix-the-bug.md');

    expect(path).toBe('Projecten/X/todos/fix-the-bug-2.md');
  });

  it('walks past taken suffixes', async () => {
    const vault = new FakeVault();
    vault.notes.add('Projecten/X/todos/fix-the-bug.md');
    vault.notes.add('Projecten/X/todos/fix-the-bug-2.md');

    const path = await freePath(vault, 'Projecten/X/todos/fix-the-bug.md');

    expect(path).toBe('Projecten/X/todos/fix-the-bug-3.md');
  });
});
