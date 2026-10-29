import { describe, expect, it } from 'vitest';
import { SyncChecklistAction } from '../../../../../src/core/application/actions/sync-checklist/SyncChecklistAction.js';
import { FakeVault as FakeVaultBase } from '../../../../helpers/fakeVault.js';

// S27 decision 1 — ticking a checklist box sets the linked note's completion.
// Real notes carry no `completed` line: TaskNoteMapper renders none, and the
// vault's Templates/Task.md has none. The write must add the field, not silently
// drop it because `rewriteFrontmatterFields` defaults `appendMissing` to false.
//
// The sibling SyncChecklistAction.completion.test.ts is locked and its `todoNote`
// fixture always carries a `completed` line, so it cannot catch this. This file
// asserts on the written note's content, not on an internal.

class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  override async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  override async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
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

const projectName = 'Acme Widgets';
const taskPath = `Projecten/${projectName}/taken/42-fix-the-bug.md`;
const taskLink = '42-fix-the-bug';
const todoPath = `Projecten/${projectName}/taken/Fix the bug.md`;
const syncedAt = '2026-09-18T12:00:00Z';

function taskNote(body: string): string {
  return [
    '---',
    'url: https://github.com/acme/widgets/issues/42',
    'status: Building',
    `affiliation: ["[[${projectName}]]"]`,
    `synced: ${syncedAt}`,
    '---',
    body,
  ].join('\n');
}

// The shape a real to-do note has: TaskNoteMapper renders no `completed` line.
function todoWithoutCompletion(): string {
  return [
    '---',
    'categories: [taken]',
    'labels: [type:todo]',
    'status: open',
    `affiliation: ["[[_${projectName}]]", "[[${taskLink}]]"]`,
    `synced: ${syncedAt}`,
    '---',
    '',
  ].join('\n');
}

describe('ST-1 — the box write adds a completion the note lacks', () => {
  it('adds a completed line when the linked note has none', async () => {
    const vault = new FakeVault();
    const action = new SyncChecklistAction(vault, 'Templates/Task.md');
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, todoWithoutCompletion());

    await action.execute({ notePath: taskPath, projectName, syncedAt });

    expect(vault.notes.get(todoPath)).toMatch(
      /^completed: 2026-09-18T12:00:00Z$/m,
    );
  });
});
