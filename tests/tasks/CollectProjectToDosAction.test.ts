import { describe, expect, it } from 'vitest';
import { CollectProjectToDosAction } from '../../src/tasks/CollectProjectToDosAction.js';
import type { VaultPort } from '../../src/vault/VaultPort.js';

class FakeVault {
  notes = new Map<string, string>();
  folders = new Map<string, string[]>();

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async listNotesInFolder(folder: string): Promise<string[]> {
    return this.folders.get(folder) ?? [];
  }
}

function harness() {
  const vault = new FakeVault();
  const action = new CollectProjectToDosAction(vault as unknown as VaultPort);
  return { action, vault };
}

const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';
const taskNote = [
  '---',
  'type: task',
  'status: Building',
  '---',
  '- [ ] [[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]',
].join('\n');
const todoNote = ['---', 'status: open', '---', 'body'].join('\n');

describe('TODO-3 — a slice to-do sits top-level in its lane', () => {
  it('collects a checklist-linked to-do with its owning task’s type and lane', async () => {
    const h = harness();
    h.vault.folders.set('Projecten/Acme Widgets/taken', [taskPath]);
    h.vault.notes.set(taskPath, taskNote);
    h.vault.notes.set(todoPath, todoNote);

    const items = await h.action.execute('Acme Widgets');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      notePath: todoPath,
      title: 'Fix the bug',
      taskNotePath: taskPath,
      taskType: 'task',
      taskLane: 'Building',
      parentStem: null,
    });
  });

  it('resolves a legacy bare wikilink to the project’s to-do folder', async () => {
    const h = harness();
    const legacyTask = taskNote.replace(
      '[[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]',
      '[[fix-the-bug|Fix the bug]]',
    );
    h.vault.folders.set('Projecten/Acme Widgets/taken', [taskPath]);
    h.vault.notes.set(taskPath, legacyTask);
    h.vault.notes.set(todoPath, todoNote);

    const items = await h.action.execute('Acme Widgets');

    expect(items.map((item) => item.notePath)).toEqual([todoPath]);
  });

  it('derives the parent to-do stem from the affiliation', async () => {
    const h = harness();
    h.vault.folders.set('Projecten/Acme Widgets/taken', [taskPath]);
    h.vault.notes.set(taskPath, taskNote);
    h.vault.notes.set(
      todoPath,
      [
        '---',
        'status: open',
        'affiliation: ["[[_Acme Widgets]]", "[[the-task]]", "[[parent-todo]]"]',
        '---',
        'body',
      ].join('\n'),
    );

    const items = await h.action.execute('Acme Widgets');

    expect(items[0]?.parentStem).toBe('parent-todo');
  });

  it('ignores a checklist item whose to-do note is missing', async () => {
    const h = harness();
    h.vault.folders.set('Projecten/Acme Widgets/taken', [taskPath]);
    h.vault.notes.set(taskPath, taskNote);

    const items = await h.action.execute('Acme Widgets');

    expect(items).toEqual([]);
  });
});
