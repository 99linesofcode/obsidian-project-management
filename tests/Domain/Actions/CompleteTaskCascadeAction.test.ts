import { describe, expect, it } from 'vitest';
import { CompleteTaskCascadeAction } from '../../../src/Domain/Actions/CompleteTaskCascadeAction.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// Fakes at the vault port: a path-keyed note store recording every write, so
// the cascade's gates (an already-done to-do, an already-checked line) are
// observable.
class FakeVault implements VaultPort {
  notes = new Map<string, string>();
  written: Array<{ path: string; content: string }> = [];
  trashed: string[] = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }
  async writeNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.written.push({ path, content });
  }
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
  async trashNote(path: string): Promise<void> {
    this.notes.delete(path);
    this.trashed.push(path);
  }
  async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  onNoteChanged(): void {}
  onNoteDeleted(): void {}
  onNoteRenamed(): void {}
}

const projectName = 'Acme Widgets';
const doneLane = 'Shipped';
const syncedAt = '2026-09-18T12:00:00Z';
const taskPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const taskStem = '42-fix-the-bug';
const slicePath = 'Projecten/Acme Widgets/taken/40-the-slice.md';
const todoPath = 'Projecten/Acme Widgets/todos/fix-the-bug.md';

function taskNote(
  status: string,
  body: string,
  affiliation = `["[[${projectName}]]"]`,
): string {
  return [
    '---',
    'url: https://github.com/acme/widgets/issues/42',
    `status: ${status}`,
    `affiliation: ${affiliation}`,
    `synced: ${syncedAt}`,
    '---',
    body,
  ].join('\n');
}

function toDoNote(
  status: string,
  taskLink = taskStem,
  completed: string | null = null,
): string {
  return [
    '---',
    `status: ${status}`,
    `completed: ${completed ?? ''}`,
    `affiliation: ["[[${projectName}]]", "[[${taskLink}]]"]`,
    '---',
    '',
  ].join('\n');
}

function sliceNote(lineChecked: boolean): string {
  const box = lineChecked ? 'x' : ' ';
  return [
    '---',
    'url: https://github.com/acme/widgets/issues/40',
    `status: ${doneLane}`,
    `affiliation: ["[[${projectName}]]"]`,
    '---',
    `- [${box}] [[${taskPath}|Fix the bug]]`,
  ].join('\n');
}

function makeAction(vault: FakeVault) {
  return new CompleteTaskCascadeAction(vault, doneLane);
}

const input = { notePath: taskPath, projectName, syncedAt };

describe('CompleteTaskCascadeAction', () => {
  it('completes the task checklist line and its open to-do notes', async () => {
    // Given — a done task with an unchecked line and an open to-do
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(doneLane, `- [ ] [[${todoPath}|Fix]]`));
    vault.notes.set(todoPath, toDoNote('open'));
    const action = makeAction(vault);

    // When — the cascade runs
    await action.execute(input);

    // Then — the line is checked and the to-do is completed
    expect(vault.notes.get(taskPath)).toContain(`- [x] [[${todoPath}|Fix]]`);
    expect(vault.notes.get(todoPath)).toContain('status: completed');
    expect(vault.notes.get(todoPath)).toContain(`completed: ${syncedAt}`);
  });

  it('leaves an already-completed to-do untouched', async () => {
    // Given — a done task whose to-do was already completed
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(doneLane, `- [x] [[${todoPath}|Fix]]`));
    vault.notes.set(todoPath, toDoNote('completed', taskStem, syncedAt));
    const action = makeAction(vault);

    // When — the cascade runs
    await action.execute(input);

    // Then — nothing is written (the gate is the diff)
    expect(vault.written).toEqual([]);
  });

  it("does not complete another task's to-do", async () => {
    // Given — a done task with its own linked to-do and a sibling's to-do
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(doneLane, `- [ ] [[${todoPath}|Fix]]`));
    vault.notes.set(todoPath, toDoNote('open'));
    const otherPath = 'Projecten/Acme Widgets/todos/other.md';
    vault.notes.set(otherPath, toDoNote('open', '99-other-task'));
    const action = makeAction(vault);

    // When — the cascade runs
    await action.execute(input);

    // Then — only this task's linked to-do completes
    expect(vault.notes.get(todoPath)).toContain('status: completed');
    expect(vault.notes.get(otherPath)).toContain('status: open');
  });

  it("checks the task's line in its parent slice", async () => {
    // Given — a done task nested under a slice with an unchecked line
    const vault = new FakeVault();
    vault.notes.set(
      taskPath,
      taskNote(doneLane, '', `["[[${projectName}]]", "[[40-the-slice]]"]`),
    );
    vault.notes.set(slicePath, sliceNote(false));
    const action = makeAction(vault);

    // When — the cascade runs
    await action.execute(input);

    // Then — the slice's line for the task is checked
    expect(vault.written).toEqual([
      { path: slicePath, content: sliceNote(true) },
    ]);
  });

  it('reopen unchecks the slice line but never reopens the to-dos', async () => {
    // Given — an open task whose slice line is checked and whose to-do is done
    const vault = new FakeVault();
    vault.notes.set(
      taskPath,
      taskNote('Building', '', `["[[${projectName}]]", "[[40-the-slice]]"]`),
    );
    vault.notes.set(slicePath, sliceNote(true));
    vault.notes.set(todoPath, toDoNote('completed', taskStem, syncedAt));
    const action = makeAction(vault);

    // When — the cascade runs on the reopened task
    await action.execute(input);

    // Then — only the slice line follows; the to-do stays completed
    expect(vault.written).toEqual([
      { path: slicePath, content: sliceNote(false) },
    ]);
    expect(vault.notes.get(todoPath)).toContain('status: completed');
  });

  it('writes nothing on a second pass over a settled task', async () => {
    // Given — a done task already fully cascaded
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(doneLane, `- [x] [[${todoPath}|Fix]]`));
    vault.notes.set(todoPath, toDoNote('completed', taskStem, syncedAt));
    vault.notes.set(taskPath, taskNote(doneLane, `- [x] [[${todoPath}|Fix]]`));
    const action = makeAction(vault);

    // When — the cascade runs twice
    await action.execute(input);
    vault.written = [];
    await action.execute(input);

    // Then — the second pass is a no-op
    expect(vault.written).toEqual([]);
  });

  it('no-ops for a task with no parent slice and no to-dos', async () => {
    // Given — a done top-level task with an empty body
    const vault = new FakeVault();
    vault.notes.set(taskPath, taskNote(doneLane, ''));
    const action = makeAction(vault);

    // When — the cascade runs
    await action.execute(input);

    // Then — there is nothing to project
    expect(vault.written).toEqual([]);
  });
});
