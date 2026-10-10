import {
  parseChecklist,
  renderChecklist,
  type ChecklistItem,
} from '../Checklist.js';
import { freePath } from '../freePath.js';
import { stemOf } from '../stemOf.js';
import { splitFrontmatter } from '../splitFrontmatter.js';
import { slugify } from '../TaskNoteMapper.js';
import { taskLinkFromAffiliation } from '../taskLinkFromAffiliation.js';
import { ToDoNoteMapper, type ToDoNoteContext } from '../ToDoNoteMapper.js';
import { ToDoNoteParser, withToDoStatus } from '../ToDoNoteParser.js';
import { withBody } from '../withBody.js';
import { readTemplate } from '../readTemplate.js';
import type { NoteEnumeratorPort } from '../ports/NoteEnumeratorPort.js';
import type { NoteReaderPort } from '../ports/NoteReaderPort.js';
import type { NoteWriterPort } from '../ports/NoteWriterPort.js';

export interface SyncChecklistInput {
  notePath: string;
  projectName: string;
  syncedAt: string;
}

export class SyncChecklistAction {
  constructor(
    private readonly vault: NoteReaderPort &
      NoteWriterPort &
      NoteEnumeratorPort,
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
    const template = await readTemplate(this.vault, this.todoTemplatePath);

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

function isDrifted(slug: string, stem: string): boolean {
  return slug !== stem && slug !== stem.replace(/-\d+$/, '');
}

function todosFolder(projectName: string): string {
  return `Projecten/${projectName}/todos`;
}

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
