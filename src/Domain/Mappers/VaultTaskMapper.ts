import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { ToDoData } from '../DataTransferObjects/ToDoData.js';
import { parseChecklist, type ChecklistItem } from '../Notes/Checklist.js';
import { stemOf } from '../Notes/stemOf.js';
import { stripLink } from '../Notes/stripLink.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
import {
  TaskNoteMapper,
  titleFromNotePath,
  type TaskNote,
} from '../Notes/TaskNoteMapper.js';
import { TaskNoteParser } from '../Notes/TaskNoteParser.js';
import { ToDoNoteMapper, type ToDoNote } from '../Notes/ToDoNoteMapper.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';

// The vault side of the canonical task and to-do. A task note carries its
// issue url, lane (status), body and affiliation; a to-do note carries its
// status, completion stamp and affiliation. The mapper wraps the existing
// parsers and note mappers, so the vault boundary has one home.
export interface VaultTaskContext {
  projectName: string;
  // The project's done lane, so a note's status can be read as completed.
  doneLane: string;
}

export interface VaultTaskRenderContext {
  projectName: string;
  syncedAt: string;
}

export const VaultTaskMapper = {
  parseTask(
    content: string,
    notePath: string,
    context: VaultTaskContext,
  ): TaskData | null {
    const parsed = TaskNoteParser.parse(content);
    if (!parsed) {
      return null;
    }
    const remoteId = remoteIdFromNotePath(notePath);
    return {
      url: parsed.url,
      remoteId,
      nodeId: '',
      todoistId: anchorOf(content),
      notePath,
      title: titleFromNotePath(notePath, remoteId),
      body: parsed.body,
      status: parsed.status,
      completed: context.doneLane !== '' && parsed.status === context.doneLane,
      parent: taskLinkFromAffiliation(parsed.affiliation, context.projectName),
      labels: [],
      updatedAt: '',
    };
  },

  parseToDo(
    content: string,
    notePath: string,
    context: VaultTaskContext,
  ): ToDoData | null {
    const parsed = ToDoNoteParser.parse(content);
    if (!parsed) {
      return null;
    }
    const links = parsed.affiliation
      .map(stripLink)
      .filter((target) => target !== context.projectName);
    return {
      todoistId: anchorOf(content),
      notePath,
      projectName: context.projectName,
      taskLink: links[0] ?? '',
      parentTodoLink: links[1] ?? null,
      title: titleFromNotePath(notePath, 0),
      status: parsed.status === 'completed' ? 'completed' : 'open',
      ...(parsed.completed === null ? {} : { completedAt: parsed.completed }),
    };
  },

  parseChecklist(body: string): ChecklistItem[] {
    return parseChecklist(body);
  },

  renderTask(task: TaskData, context: VaultTaskRenderContext): TaskNote {
    return TaskNoteMapper.map(task, {
      projectName: context.projectName,
      syncedAt: context.syncedAt,
      statusName: task.status,
    });
  },

  renderToDo(todo: ToDoData, syncedAt: string): ToDoNote {
    return ToDoNoteMapper.map(
      {
        title: todo.title,
        projectName: todo.projectName,
        taskLink: todo.taskLink,
        ...(todo.parentTodoLink === null
          ? {}
          : { parentTodoLink: todo.parentTodoLink }),
      },
      {
        syncedAt,
        statusName: todo.status,
        ...(todo.completedAt === undefined
          ? {}
          : { completedAt: todo.completedAt }),
      },
    );
  },
};

// The leading `<remoteId>-` prefix of an issue-backed note's stem, or 0 when
// the note carries none (a captured draft).
function remoteIdFromNotePath(notePath: string): number {
  const match = stemOf(notePath).match(/^(\d+)-/);
  return match === null ? 0 : Number(match[1]);
}

// A note's `todoist` frontmatter anchor, or '' when absent or empty.
function anchorOf(content: string): string {
  return splitFrontmatter(content)?.fields.get('todoist') ?? '';
}
