import { beforeEach, describe, expect, it } from 'vitest';
import { SyncChecklistAction } from '../../../../../src/core/application/actions/sync-checklist/SyncChecklistAction.js';
import {
  splitFrontmatter,
  typeFromLabels,
} from '../../../../../src/core/domain/note.js';
import { ToDoNoteParser } from '../../../../../src/core/domain/ToDoNoteParser.js';
import { CanonicalTask } from '../../../../../src/core/port/data/CanonicalTask.js';
import { parseTaskNote } from '../../../../../src/infrastructure/vault/taskNoteCodec.js';
import { FakeVault as FakeVaultBase } from '../../../../helpers/fakeVault.js';

// S27 decision 1 — the box writes the linked note's `completed`, never its
// `status`. The spec states the rule (S27, "Rule this delta introduces") and
// makes ST-1 explicit at the checklist boundary: state is the lane, completion
// is a separate fact, and neither is inferred from the other. No kind check is
// taken — the write is correct for a to-do and for a task alike.
//
// These are the acceptance tests for that rule; the sibling
// SyncChecklistAction.test.ts still pins the pre-S27 to-do `status` write and
// is owned by settled decision 2 (the to-do-`status`-removal slice), not S27.

class FakeVault extends FakeVaultBase {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  notes = new Map<string, string>();
  created: Array<{ path: string; content: string }> = [];
  written: Array<{ path: string; content: string }> = [];
  renamed: Array<{ oldPath: string; newPath: string }> = [];
  trashed: string[] = [];

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

  async moveFolder(): Promise<void> {}
  override async renameNote(oldPath: string, newPath: string): Promise<void> {
    const content = this.notes.get(oldPath);
    if (content === undefined) {
      return;
    }
    this.notes.delete(oldPath);
    this.notes.set(newPath, content);
    this.renamed.push({ oldPath, newPath });
  }

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }

  override async trashNote(path: string): Promise<void> {
    this.notes.delete(path);
    this.trashed.push(path);
  }

  override async readTask(handle: string): Promise<CanonicalTask | null> {
    const content = this.notes.get(handle);
    if (content === undefined) {
      return null;
    }
    const note = parseTaskNote(content, handle);
    if (typeFromLabels(note.labels) === '') {
      return null;
    }
    return new CanonicalTask({
      handle,
      entityId: handle,
      title: note.title,
      body: note.body,
      status: note.status,
      completed: note.completed,
      parent: note.parent,
      labels: note.labels,
    });
  }

  override async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }

  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
}

const projectName = 'Acme Widgets';
const parentPath = 'Projecten/Acme Widgets/taken/42-fix-the-bug.md';
const parentLink = '42-fix-the-bug';
const todoPath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';
const linkedTaskPath = 'Projecten/Acme Widgets/taken/7-ship-it.md';
const syncedAt = '2026-09-18T12:00:00Z';
const earlier = '2026-09-01T09:00:00Z';

// The parent note that carries the checklist box. It is a task note (a lane
// holder), as in the sibling suite.
function parentNote(body: string): string {
  return [
    '---',
    'url: https://github.com/acme/widgets/issues/42',
    'status: Building',
    'affiliation: ["[[Acme Widgets]]"]',
    `synced: ${syncedAt}`,
    '---',
    body,
  ].join('\n');
}

// A to-do note: carries type:todo and a status lane.
function todoNote(
  status: 'open' | 'completed',
  completed: string | null,
): string {
  return [
    '---',
    'categories: [taken]',
    'labels: [type:todo]',
    `status: ${status}`,
    `completed: ${completed ?? ''}`,
    `affiliation: ["[[_Acme Widgets]]", "[[${parentLink}]]"]`,
    `synced: ${syncedAt}`,
    '---',
    '',
  ].join('\n');
}

// A task note: a lane holder with no type:todo label. This is the case the
// cascade/box write conflated today.
function linkedTaskNote(status: string, completed: string | null): string {
  return [
    '---',
    'url: https://github.com/acme/widgets/issues/7',
    `status: ${status}`,
    `completed: ${completed ?? ''}`,
    `affiliation: ["[[Acme Widgets]]", "[[${parentLink}]]"]`,
    `synced: ${syncedAt}`,
    '---',
    '',
  ].join('\n');
}

function bodyOf(content: string): string {
  return splitFrontmatter(content)?.body ?? content;
}

let vault: FakeVault;
let action: SyncChecklistAction;

beforeEach(() => {
  vault = new FakeVault();
  action = new SyncChecklistAction(vault, 'Templates/Task.md');
});

describe('ST-1 — ticking a checklist box sets the linked note completion, never its status', () => {
  it('completes a linked to-do and leaves its status untouched', async () => {
    vault.notes.set(
      parentPath,
      parentNote(`- [x] [[${todoPath}|Fix the bug]]`),
    );
    vault.notes.set(todoPath, todoNote('open', null));

    await action.execute({ notePath: parentPath, projectName, syncedAt });

    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.completed).toBe(syncedAt);
    expect(parsed?.status).toBe('open');
    expect(vault.written.map((entry) => entry.path)).toEqual([todoPath]);
  });

  it('completes a linked task and leaves its lane untouched', async () => {
    vault.notes.set(
      parentPath,
      parentNote(`- [x] [[${linkedTaskPath}|7 ship it]]`),
    );
    vault.notes.set(linkedTaskPath, linkedTaskNote('Building', null));

    await action.execute({ notePath: parentPath, projectName, syncedAt });

    const parsed = parseTaskNote(
      vault.notes.get(linkedTaskPath)!,
      linkedTaskPath,
    );
    // The canonical task completion is the boolean `completion` field
    // (taskNoteCodec `isCompleted`), whatever stamp the write carries.
    expect(parsed.completed).toBe(true);
    expect(parsed.status).toBe('Building');
    expect(vault.written.map((entry) => entry.path)).toEqual([linkedTaskPath]);
  });
});

describe('ST-1 — un-ticking a checklist box clears the linked note completion', () => {
  it('clears a linked to-do completion and leaves its status untouched', async () => {
    vault.notes.set(
      parentPath,
      parentNote(`- [ ] [[${todoPath}|Fix the bug]]`),
    );
    vault.notes.set(todoPath, todoNote('open', earlier));

    await action.execute({ notePath: parentPath, projectName, syncedAt });

    const parsed = ToDoNoteParser.parse(vault.notes.get(todoPath)!);
    expect(parsed?.completed).toBeNull();
    expect(parsed?.status).toBe('open');
  });

  it('clears a linked task completion and leaves its lane untouched', async () => {
    vault.notes.set(
      parentPath,
      parentNote(`- [ ] [[${linkedTaskPath}|7 ship it]]`),
    );
    vault.notes.set(linkedTaskPath, linkedTaskNote('Building', earlier));

    await action.execute({ notePath: parentPath, projectName, syncedAt });

    const parsed = parseTaskNote(
      vault.notes.get(linkedTaskPath)!,
      linkedTaskPath,
    );
    expect(parsed.completed).toBe(false);
    expect(parsed.status).toBe('Building');
  });
});

describe('ST-1 — the drift rename is unchanged by this slice', () => {
  it('renames the linked note when the box text drifts from its filename', async () => {
    const stalePath = 'Projecten/Acme Widgets/taken/fi.md';
    vault.notes.set(
      parentPath,
      parentNote(`- [ ] [[${stalePath}|Fix the bug]]`),
    );
    vault.notes.set(stalePath, linkedTaskNote('Building', null));

    await action.execute({ notePath: parentPath, projectName, syncedAt });

    expect(vault.renamed).toEqual([{ oldPath: stalePath, newPath: todoPath }]);
    expect(vault.notes.has(stalePath)).toBe(false);
    expect(vault.notes.has(todoPath)).toBe(true);
    expect(parseTaskNote(vault.notes.get(todoPath)!, todoPath).status).toBe(
      'Building',
    );
    expect(bodyOf(vault.notes.get(parentPath)!)).toBe(
      `- [ ] [[${todoPath}|Fix the bug]]`,
    );
  });
});
