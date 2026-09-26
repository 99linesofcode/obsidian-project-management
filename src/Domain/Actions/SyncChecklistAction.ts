import {
  parseChecklist,
  renderChecklist,
  type ChecklistItem,
} from '../Notes/Checklist.js';
import { freePath } from '../Notes/freePath.js';
import { stemOf } from '../Notes/stemOf.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { slugify } from '../Notes/TaskNoteMapper.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
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
    const taskLink = stemOf(input.notePath);
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
      const path = await this.createTodo(
        input,
        item,
        todoPath(input.projectName, item.text),
        template,
        taskLink,
      );
      item.linkPath = path;
      promoted = true;
    }

    return promoted;
  }

  // A linked item mirrors onto its to-do: a missing note is resolved before
  // anything is created (a short or wrong-folder link is relinked to the to-do
  // that already exists; only a genuinely absent one is re-promoted), a
  // drifted filename is renamed to the item's slug, and an existing one follows
  // the checkbox. Returns whether a relink or rename changed a link, so the
  // caller rewrites the parent body once. A to-do with nothing to change is
  // left alone — that is what lets the scheduler's echo settle.
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
        const existing = await this.findTodoForMissingLink(
          input,
          item,
          item.linkPath,
        );
        if (existing !== null) {
          item.linkPath = existing;
          relinked = true;
          continue;
        }
        const path = await this.createTodo(
          input,
          item,
          item.linkPath,
          template,
          taskLink,
        );
        if (path !== item.linkPath) {
          item.linkPath = path;
          relinked = true;
        }
        continue;
      }

      const parsed = ToDoNoteParser.parse(note.content);
      if (!parsed) {
        continue;
      }

      if (isDrifted(slugify(item.text), stemOf(item.linkPath))) {
        const newPath = await freePath(
          this.vault,
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

  // A missing link is resolved before anything is created: a to-do already in
  // the project's folder wins (the link was merely short or pointed at the
  // wrong folder), and only a genuinely absent to-do is re-promoted. A link
  // already under todos/ is left to the self-heal path, so a deleted to-do is
  // restored in place rather than duplicated.
  private async findTodoForMissingLink(
    input: SyncChecklistInput,
    item: ChecklistItem,
    linkPath: string,
  ): Promise<string | null> {
    if (isInTodosFolder(input.projectName, linkPath)) {
      return null;
    }
    const linkStem = stemOf(linkPath);
    const textSlug = slugify(item.text);
    for (const path of await this.vault.listNotesInFolder(
      todosFolder(input.projectName),
    )) {
      const stem = stemOf(path);
      if (stem === linkStem || stem === textSlug) {
        return path;
      }
    }
    return null;
  }

  // The single place a to-do is created. The hard guard lives here: a
  // candidate outside the project's todos folder is replaced by the canonical
  // slug path, so a malformed link can never litter the vault root or another
  // folder. freePath then keeps a slug collision from overwriting a note.
  private async createTodo(
    input: SyncChecklistInput,
    item: ChecklistItem,
    candidate: string,
    template: string | null,
    taskLink: string,
  ): Promise<string> {
    const base = isInTodosFolder(input.projectName, candidate)
      ? candidate
      : todoPath(input.projectName, item.text);
    const path = await freePath(this.vault, base);
    const note = ToDoNoteMapper.render(
      template,
      { title: item.text, projectName: input.projectName, taskLink },
      toDoContext(input.syncedAt, item.checked),
    );
    await this.vault.createNote(path, note.content);
    return path;
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
    const folder = todosFolder(input.projectName);

    for (const path of await this.vault.listNotesInFolder(folder)) {
      if (linked.has(path)) {
        continue;
      }
      const note = await this.vault.getNoteByPath(path);
      if (!note) {
        continue;
      }
      const parsed = ToDoNoteParser.parse(note.content);
      if (parsed === null) {
        continue;
      }
      // Gate: trash only when the to-do's CURRENT affiliation still names this
      // task as its primary parent. A note whose affiliation was just rewritten
      // (by the projection or a capture) no longer leads with this task, so it
      // is left alone rather than trashed by a stale membership read.
      if (
        taskLinkFromAffiliation(parsed.affiliation, input.projectName) !==
        taskLink
      ) {
        continue;
      }
      await this.vault.trashNote(path);
    }
  }
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

function todosFolder(projectName: string): string {
  return `Projecten/${projectName}/todos`;
}

// The hard guard's predicate: a path is inside the project's todos folder only
// when it is a child of it, so a sibling like `todos-archive/` cannot pass.
function isInTodosFolder(projectName: string, path: string): boolean {
  return path.startsWith(`${todosFolder(projectName)}/`);
}

function todoPath(projectName: string, title: string): string {
  return `${todosFolder(projectName)}/${slugify(title)}.md`;
}

function toDoContext(syncedAt: string, checked: boolean): ToDoNoteContext {
  return checked
    ? { syncedAt, statusName: 'completed', completedAt: syncedAt }
    : { syncedAt, statusName: 'open' };
}
