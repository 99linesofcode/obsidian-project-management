import { describe, expect, it } from 'vitest';
import { freePath } from '../../../src/Domain/Notes/freePath.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// A vault fake backed by a path set, so the collision walk is observable.
class FakeVault implements VaultPort {
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

describe('freePath', () => {
  it('returns the base path when it is free', async () => {
    // Given — an empty vault
    const vault = new FakeVault();

    // When — a free path is requested
    const path = await freePath(vault, 'Projecten/X/todos/fix-the-bug.md');

    // Then — the base path is returned
    expect(path).toBe('Projecten/X/todos/fix-the-bug.md');
  });

  it('suffixes -2 when the base path is taken', async () => {
    // Given — a vault already holding the base path
    const vault = new FakeVault();
    vault.notes.add('Projecten/X/todos/fix-the-bug.md');

    // When — a free path is requested
    const path = await freePath(vault, 'Projecten/X/todos/fix-the-bug.md');

    // Then — the first free suffix is returned
    expect(path).toBe('Projecten/X/todos/fix-the-bug-2.md');
  });

  it('walks past taken suffixes', async () => {
    // Given — a vault holding the base path and its first suffix
    const vault = new FakeVault();
    vault.notes.add('Projecten/X/todos/fix-the-bug.md');
    vault.notes.add('Projecten/X/todos/fix-the-bug-2.md');

    // When — a free path is requested
    const path = await freePath(vault, 'Projecten/X/todos/fix-the-bug.md');

    // Then — the next free suffix is returned
    expect(path).toBe('Projecten/X/todos/fix-the-bug-3.md');
  });
});
