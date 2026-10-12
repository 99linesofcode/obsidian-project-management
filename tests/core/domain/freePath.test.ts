import { describe, expect, it } from 'vitest';
import { freePath } from '../../../src/core/domain/freePath.js';
import { FakeVault as FakeVaultBase } from '../../helpers/fakeVault.js';

// A vault fake backed by a path set, so the collision walk is observable.
class FakeVault extends FakeVaultBase {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Set<string>();

  override async getNoteByPath(path: string): Promise<{ content: string } | null> {
    return this.notes.has(path) ? { content: '' } : null;
  }

  override async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async writeNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  async moveFolder(): Promise<void> {}

  override async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
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
