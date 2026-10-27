import { describe, expect, it } from 'vitest';
import { MirrorTodoStatusAction } from '../../../../src/core/application/actions/MirrorTodoStatusAction.js';
import { splitFrontmatter } from '../../../../src/core/domain/note.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

// S27 decision 1 — the two halves of the line↔note mechanism must agree. The box
// write (`SyncChecklistAction.mirrorLinkedItem`) now writes only the linked
// note's `completed` and leaves its `status` alone; the note→line read here must
// key on the same field. Seeding a note whose completion is set but whose status
// is not is the narrowest seam that catches the disagreement: a status-keyed
// read computes the box as unchecked and rewrites the parent with it un-ticked.
//
// The existing MirrorTodoStatusAction.test.ts still pins the pre-S27
// status-keyed read; its status cases belong to the to-do-`status`-removal slice
// (settled decision 2), not S27, and are left untouched here.

class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  written: Array<{ path: string; content: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async createNote(): Promise<never> {
    throw new Error('not used in this test');
  }

  override async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }

  override async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }

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

const projectName = 'Acme Widgets';
const taskPath = `Projecten/${projectName}/taken/42-fix-the-bug.md`;
const taskLink = '42-fix-the-bug';
const todoPath = `Projecten/${projectName}/taken/fix-the-bug.md`;
const syncedAt = '2026-09-18T12:00:00Z';
const earlier = '2026-09-01T09:00:00Z';

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

function bodyOf(content: string): string {
  return splitFrontmatter(content)?.body ?? content;
}

// The shape the S27 box write produces: the completion is set (or cleared) and
// the lane is whatever it was — never inferred from the completion.
function completedNote(lane: string, completed: string | null): string {
  return [
    '---',
    'categories: [taken]',
    'labels: [type:todo]',
    `status: ${lane}`,
    `completed: ${completed ?? ''}`,
    `affiliation: ["[[_${projectName}]]", "[[${taskLink}]]"]`,
    `synced: ${syncedAt}`,
    '---',
    '',
  ].join('\n');
}

describe('ST-1 — the note→line read keys on completion, agreeing with the box write', () => {
  it('ticks the parent line from the linked note completion, not its status', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [ ] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, completedNote('open', earlier));
    const action = new MirrorTodoStatusAction(vault);

    await action.execute({ todoPath, syncedAt });

    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [x] [[${todoPath}|Fix the bug]]`,
    );
  });

  it('unticks the parent line when the completion is cleared, even if the lane reads completed', async () => {
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(`- [x] [[${todoPath}|Fix the bug]]`));
    vault.notes.set(todoPath, completedNote('completed', null));
    const action = new MirrorTodoStatusAction(vault);

    await action.execute({ todoPath, syncedAt });

    expect(bodyOf(vault.notes.get(taskPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });
});
