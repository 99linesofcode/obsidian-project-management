import {
  parseChecklist,
  renderChecklist,
  type ChecklistItem,
} from '../Notes/Checklist.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { slugify } from '../Notes/TaskNoteMapper.js';
import {
  ToDoNoteMapper,
  type ToDoNoteContext,
} from '../Notes/ToDoNoteMapper.js';
import { ToDoNoteParser, withToDoStatus } from '../Notes/ToDoNoteParser.js';
import { withBody } from '../Notes/withBody.js';
import type { VaultPort } from '../Ports/VaultPort.js';

export interface SyncChecklistInput {
  notePath: string;
  projectName: string;
  syncedAt: string;
}

// UC: keep a task note's markdown checklist and the project's vault-only to-do
// notes in step. The checklist line is the source of truth: an unlinked line is
// promoted to a to-do, a checked line completes its to-do, a renamed line
// renames its to-do, and removing the line trashes the note. The action
// settles: its own rewrites re-trigger it, and the second pass writes nothing.
export class SyncChecklistAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly todoTemplatePath: string,
  ) {}

  async execute(input: SyncChecklistInput): Promise<void> {
    const note = await this.vault.getNoteByPath(input.notePath);
    if (!note) {
      return;
    }

    const body = splitFrontmatter(note.content)?.body ?? note.content;
    const items = parseChecklist(body);
    const taskLink = taskLinkFromPath(input.notePath);
    const template = await this.readTemplate();

    const promoted = await this.promoteUnlinked(
      input,
      taskLink,
      template,
      items,
    );
    const relinked = await this.mirrorLinked(input, taskLink, template, items);

    if (promoted || relinked) {
      await this.vault.writeNote(
        input.notePath,
        withBody(note.content, renderChecklist(body, items)),
      );
    }

    await this.removeDropped(input, taskLink, items);
  }

  private async readTemplate(): Promise<string | null> {
    const template = await this.vault.getNoteByPath(this.todoTemplatePath);
    return template?.content ?? null;
  }

  // Every unlinked item gets its own to-do at the next free slug; the item
  // then carries the link so the rewrite below writes it into the line.
  private async promoteUnlinked(
    input: SyncChecklistInput,
    taskLink: string,
    template: string | null,
    items: ChecklistItem[],
  ): Promise<boolean> {
    let promoted = false;

    for (const item of items) {
      if (item.linkPath !== undefined) {
        continue;
      }
      const path = await this.freePath(todoPath(input.projectName, item.text));
      const note = ToDoNoteMapper.render(
        template,
        { title: item.text, projectName: input.projectName, taskLink },
        toDoContext(input.syncedAt, item.checked),
      );
      await this.vault.createNote(path, note.content);
      item.linkPath = path;
      promoted = true;
    }

    return promoted;
  }

  // A linked item mirrors onto its to-do: a missing note is re-created at the
  // linked path (a dangling link is a to-do to restore, not to forget), a
  // drifted filename is renamed to the item's slug, and an existing one follows
  // the checkbox. Returns whether a rename changed a link, so the caller
  // rewrites the parent body once. A to-do with nothing to change is left
  // alone — that is what lets the scheduler's echo settle.
  private async mirrorLinked(
    input: SyncChecklistInput,
    taskLink: string,
    template: string | null,
    items: ChecklistItem[],
  ): Promise<boolean> {
    let relinked = false;

    for (const item of items) {
      if (item.linkPath === undefined) {
        continue;
      }
      const note = await this.vault.getNoteByPath(item.linkPath);

      if (!note) {
        const created = ToDoNoteMapper.render(
          template,
          { title: item.text, projectName: input.projectName, taskLink },
          toDoContext(input.syncedAt, item.checked),
        );
        await this.vault.createNote(item.linkPath, created.content);
        continue;
      }

      const parsed = ToDoNoteParser.parse(note.content);
      if (!parsed) {
        continue;
      }

      if (isDrifted(slugify(item.text), stemOf(item.linkPath))) {
        const newPath = await this.freePath(
          todoPath(input.projectName, item.text),
        );
        await this.vault.renameNote(item.linkPath, newPath);
        item.linkPath = newPath;
        relinked = true;
      }

      if (item.checked && parsed.status !== 'completed') {
        await this.vault.writeNote(
          item.linkPath,
          withToDoStatus(note.content, 'completed', input.syncedAt),
        );
      } else if (!item.checked && parsed.status === 'completed') {
        await this.vault.writeNote(
          item.linkPath,
          withToDoStatus(note.content, 'open', null),
        );
      }
    }

    return relinked;
  }

  // A to-do this task owns but no line links to is orphaned: move it to the
  // trash. The affiliation check keeps other tasks' to-dos in the same folder
  // out of it.
  private async removeDropped(
    input: SyncChecklistInput,
    taskLink: string,
    items: ChecklistItem[],
  ): Promise<void> {
    const linked = new Set(
      items
        .map((item) => item.linkPath)
        .filter((path): path is string => path !== undefined),
    );
    const folder = `Projecten/${input.projectName}/todos`;

    for (const path of await this.vault.listNotesInFolder(folder)) {
      if (linked.has(path)) {
        continue;
      }
      const note = await this.vault.getNoteByPath(path);
      if (!note) {
        continue;
      }
      const parsed = ToDoNoteParser.parse(note.content);
      if (parsed?.affiliation.includes(`[[${taskLink}]]`)) {
        await this.vault.trashNote(path);
      }
    }
  }

  // Suffixes -2, -3, … until the to-do path is free.
  private async freePath(base: string): Promise<string> {
    if (!(await this.vault.getNoteByPath(base))) {
      return base;
    }
    const stem = base.replace(/\.md$/, '');
    let suffix = 2;
    while (await this.vault.getNoteByPath(`${stem}-${suffix}.md`)) {
      suffix++;
    }
    return `${stem}-${suffix}.md`;
  }
}

// The task's link target: the note's filename without its .md extension.
function taskLinkFromPath(notePath: string): string {
  const basename = notePath.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

// A to-do's filename stem: its basename without the .md extension.
function stemOf(path: string): string {
  const basename = path.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

// Drift exists only when the item's slug matches neither the to-do's stem nor
// the stem with a trailing -<number> collision suffix stripped. The suffix
// tolerance is essential: a collision-named to-do (test-2.md for the second
// "test" item) must not read as drift, or every pass renames it forever. The
// rule is ambiguous by design — the text "test 2" and a collision suffix are
// indistinguishable by slug — and that ambiguity is accepted.
function isDrifted(slug: string, stem: string): boolean {
  return slug !== stem && slug !== stem.replace(/-\d+$/, '');
}

function todoPath(projectName: string, title: string): string {
  return `Projecten/${projectName}/todos/${slugify(title)}.md`;
}

function toDoContext(syncedAt: string, checked: boolean): ToDoNoteContext {
  return checked
    ? { syncedAt, statusName: 'completed', completedAt: syncedAt }
    : { syncedAt, statusName: 'open' };
}
