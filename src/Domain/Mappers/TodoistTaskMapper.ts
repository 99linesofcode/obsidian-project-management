import { TaskData } from '../DataTransferObjects/TaskData.js';
import type { TodoistSectionData } from '../DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import { typeFromLabels } from '../Labels/typeFromLabels.js';

// The Todoist side of the canonical task. A fetched task carries its content,
// labels and completion; its section (a lane) and parent are separate records,
// so they are passed alongside. One-way: parse maps the provider records onto
// TaskData; the writers build their create payloads inline, so there is no
// render half.
export const TodoistTaskMapper = {
  // The remote live view. Identity (id, notePath) is left empty: the half
  // composes it from the registry record, never from the fetch. The parent is
  // the raw twin id; only the registry can turn it into the parent's uuid.
  parseTask(
    task: TodoistTaskData,
    section: TodoistSectionData | null,
    parent: TodoistTaskData | null,
  ): TaskData {
    return new TaskData(
      '', // identity is composed by the half from the registry record
      '', // notePath is composed by the half from the registry record
      { todoist: task.id }, // the live-view mirror handle
      task.content,
      // The description is not vault content (it carries the issue link); the
      // half owns the body and never diffs it for Todoist.
      '',
      section?.name ?? '',
      // The completion invariant: done <=> completedAt !== null. Todoist's own
      // completedAt is the honest stamp; '' marks "done, stamp unknown" when
      // the provider omitted it.
      task.isCompleted ? (task.completedAt ?? '') : null,
      // The label is the mirror's REPRESENTATION of the vault-owned type; the
      // half reads it back but never lets it drive a type pull.
      typeFromLabels(task.labels),
      parent?.id ?? task.parentId,
      task.addedAt || null,
      task.updatedAt || null,
    );
  },
};
