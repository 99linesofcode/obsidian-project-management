import { TaskData } from '../DataTransferObjects/TaskData.js';
import { ToDoData } from '../DataTransferObjects/ToDoData.js';
import { parseChecklist, type ChecklistItem } from '../Notes/Checklist.js';
import { stemOf } from '../Notes/stemOf.js';
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
// vault-owned id and type, lane (status), body and affiliation; a to-do note
// carries its status, completion stamp and affiliation. The mapper wraps the
// existing parsers and note mappers, so the vault boundary has one home.
export interface VaultTaskContext {
  projectName: string;
  // The project's done lane, so a note's status can be read as completed.
  doneLane: string;
}

export interface VaultTaskRenderContext {
  projectName: string;
  syncedAt: string;
}

// A to-do note is rendered from resolved affiliation links, not uuids: the
// note format is path-based presentation, and resolving a uuid to its current
// note path needs the registry. The action layer resolves and passes them in.
export interface VaultToDoRenderContext {
  projectName: string;
  syncedAt: string;
  taskLink: string;
  parentTodoLink?: string;
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
    // The parsed note guarantees a frontmatter block; read the fields the
    // parser does not surface (completed/created) off it directly.
    const fields = splitFrontmatter(content)?.fields;
    const remoteId = remoteIdFromNotePath(notePath);
    const done = context.doneLane !== '' && parsed.status === context.doneLane;
    const completedField = fields?.get('completed') ?? '';
    return new TaskData(
      // WHY '': the note carries no machine id (dt-20); the action layer
      // composes the uuid from the registry record that resolved this path.
      '',
      notePath,
      {}, // the vault live view knows no mirror handles; the registry owns them
      titleFromNotePath(notePath, remoteId),
      parsed.body,
      parsed.status,
      // A done-lane note is completed by its lane; the stamp is the note's own
      // `completed` value when it has one, '' when the lane is the only signal.
      done ? completedField : null,
      parsed.type,
      // WHY null: the affiliation resolves to the parent's uuid, which needs a
      // registry lookup the pure mapper cannot make. The action layer resolves
      // it; an unresolved parent stays null and the next pass retries.
      null,
      fields?.get('created') ?? null,
      // WHY null: the vault has no honest per-field clock. File mtime is the
      // adapter's concern, not this pure view's.
      null,
    );
  },

  parseToDo(
    content: string,
    notePath: string,
    _context: VaultTaskContext,
  ): ToDoData | null {
    const parsed = ToDoNoteParser.parse(content);
    if (!parsed) {
      return null;
    }
    const fields = splitFrontmatter(content)?.fields;
    return new ToDoData(
      // WHY '': the note carries no machine id (dt-20); the action layer
      // composes the uuid from the registry record.
      '',
      notePath,
      {}, // the vault live view knows no mirror handles; the registry owns them
      titleFromNotePath(notePath, 0),
      parsed.status === 'completed' ? 'completed' : 'open',
      parsed.completed,
      // WHY null: parentTodo is a uuid; resolving it needs the registry. The
      // action layer resolves it and leaves null until it can.
      null,
      // WHY null: the owning task is a uuid; same action-layer resolution rule.
      null,
      fields?.get('created') ?? null,
      null,
    );
  },

  parseChecklist(body: string): ChecklistItem[] {
    return parseChecklist(body);
  },

  renderTask(task: TaskData, context: VaultTaskRenderContext): TaskNote {
    return TaskNoteMapper.map(
      {
        type: task.type,
        title: task.title,
        body: task.body,
        createdAt: task.createdAt,
      },
      {
        projectName: context.projectName,
        syncedAt: context.syncedAt,
        statusName: task.status,
      },
    );
  },

  renderToDo(todo: ToDoData, context: VaultToDoRenderContext): ToDoNote {
    return ToDoNoteMapper.map(
      {
        title: todo.title,
        projectName: context.projectName,
        taskLink: context.taskLink,
        ...(context.parentTodoLink === undefined
          ? {}
          : { parentTodoLink: context.parentTodoLink }),
      },
      {
        syncedAt: context.syncedAt,
        statusName: todo.status,
        ...(todo.completedAt === null ? {} : { completedAt: todo.completedAt }),
      },
    );
  },
};

// The leading `<remoteId>-` prefix of a legacy issue-backed note's stem, or 0
// when the note carries none (a new slug-only note or a captured draft).
function remoteIdFromNotePath(notePath: string): number {
  const match = stemOf(notePath).match(/^(\d+)-/);
  return match === null ? 0 : Number(match[1]);
}
