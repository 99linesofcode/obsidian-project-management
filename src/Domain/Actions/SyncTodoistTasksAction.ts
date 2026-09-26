import { laneForSection } from '../Board/laneForSection.js';
import { hasTypeLabel } from '../Labels/hasTypeLabel.js';
import { TodoistTaskMapper } from '../Mappers/TodoistTaskMapper.js';
import { parseChecklist } from '../Notes/Checklist.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stemOf } from '../Notes/stemOf.js';
import { stripLink } from '../Notes/stripLink.js';
import { taskLinkFromAffiliation } from '../Notes/taskLinkFromAffiliation.js';
import { TaskNoteParser } from '../Notes/TaskNoteParser.js';
import { ToDoNoteParser } from '../Notes/ToDoNoteParser.js';
import { VerdictResolver } from '../Reconciliation/VerdictResolver.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { TodoistSectionData } from '../DataTransferObjects/TodoistSectionData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { ApplyTaskToTodoistAction } from './ApplyTaskToTodoistAction.js';
import type { ApplyTodoistCompletionAction } from './ApplyTodoistCompletionAction.js';
import type { ApplyTodoistRemoteChangesAction } from './ApplyTodoistRemoteChangesAction.js';
import type { CaptureTodoistCreationsAction } from './CaptureTodoistCreationsAction.js';
import type { EnsureTodoistSectionsAction } from './EnsureTodoistSectionsAction.js';
import type { PropagateTodoistDeletionsAction } from './PropagateTodoistDeletionsAction.js';

export interface SyncTodoistTasksInput {
  projectName: string;
  // The resolved Todoist project id from the chain's lifecycle verdict.
  projectId: string;
  syncedAt: string;
}

// One tracked issue resolved to its vault note: the issue carries the type
// label and the title, the note carries the lane (its status) and the slice
// affiliation. The vault is the source of truth for the shape; the issue is the
// source of the type, which the note does not carry.
interface ProjectionItem {
  issue: { url: string; title: string; labels: string[] };
  notePath: string;
  noteContent: string;
  type: string;
  lane: string;
  sliceLink: string | null;
}

// One to-do linked from a tracked task's checklist, resolved to its note and
// the twin of the task that owns it.
interface ToDoItem {
  notePath: string;
  noteContent: string;
  title: string;
  taskTwinId: string;
  // The parent to-do's note stem when this to-do nests under another to-do
  // (Todoist indent level 4 — the ceiling); null for a direct task child.
  parentStem: string | null;
}

// The Todoist half on the canonical pipeline: fetch the project's items (the
// fetch IS the probe — Todoist REST v1 has no conditional request), map each
// item to canonical TaskData/ToDoData with TodoistTaskMapper, diff it against
// the vault's desired shape and the snapshot record, and apply the winning side
// through ApplyTaskToTodoistAction. The remote -> vault absorption
// (ApplyTodoistRemoteChanges + ApplyTodoistCompletion) runs first and stays
// retained: the pull side's affiliation/twin-id duality is a later concern, so
// the absorbers canonicalise the remote->vault direction while the writer owns
// the vault->remote projection. Captured creations (dt-06) and deletion
// propagation close the half.
//
// The snapshot DTO is read straight from the canonical store (one TaskData per
// twin): `title` is the content, `status` the lane ('' = not controlled),
// `completed` the completion bit, `parent` the parent twin id.
export class SyncTodoistTasksAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly ensureSections: EnsureTodoistSectionsAction,
    private readonly applyToTodoist: ApplyTaskToTodoistAction,
    private readonly applyTodoistRemoteChanges: ApplyTodoistRemoteChangesAction,
    private readonly captureTodoistCreations: CaptureTodoistCreationsAction,
    private readonly applyTodoistCompletion: ApplyTodoistCompletionAction,
    private readonly propagateTodoistDeletions: PropagateTodoistDeletionsAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: SyncTodoistTasksInput): Promise<void> {
    try {
      // Remote -> vault first: a remote change is never clobbered by a
      // vault-side push. Both absorbers are retained (see the class comment).
      // Capture runs before the completion pass: it reads the completed-since
      // window from the stored cursor, which ApplyTodoistCompletion advances.
      await this.applyTodoistRemoteChanges.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.captureTodoistCreations.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });
      await this.applyTodoistCompletion.execute({
        projectName: input.projectName,
        projectId: input.projectId,
        syncedAt: input.syncedAt,
      });

      // The probe: one active-task fetch serves both projections.
      const active = await this.taskManager.fetchActiveTasks(input.projectId);
      await this.projectTasks(input, active);
      await this.projectToDos(input, active);

      // Deletions last (spec reconcile step 7).
      await this.propagateTodoistDeletions.execute({
        projectName: input.projectName,
      });
    } catch {
      // A Todoist failure must never break the GitHub half.
    }
  }

  // The vault's tracked tasks projected onto their twins. Slices first so a
  // child can nest under its slice's twin, then the children, then the
  // unaffiliated top-level tasks.
  private async projectTasks(
    input: SyncTodoistTasksInput,
    active: TodoistTaskData[],
  ): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    // A project without a GitHub attach has no typed issues to project (dt-03).
    if (!identity?.repoUrl) {
      return;
    }

    const projectState = await this.syncState.getTodoistProjectState(
      input.projectName,
    );
    const storedSections = projectState?.sections ?? {};
    const sections = await this.ensureSections.execute({
      projectId: input.projectId,
      laneNames: identity.statusOptions.map((option) => option.name),
      stored: storedSections,
    });
    // Only rewrite the bookkeeping when the lane map actually moved, so a
    // settled project performs no write at all.
    if (!projectState || !sameSections(sections, storedSections)) {
      await this.syncState.setTodoistProjectState(input.projectName, {
        sections,
        lastCompletedPoll: projectState?.lastCompletedPoll ?? input.syncedAt,
      });
    }

    const issues = (
      await this.projectManagement.fetchTrackedIssues(identity.repoUrl)
    ).filter((issue) => hasTypeLabel(issue.labels));
    const activeById = new Map(active.map((task) => [task.id, task] as const));

    const items: ProjectionItem[] = [];
    for (const issue of issues) {
      const status = await this.syncState.get(issue.url);
      if (!status) {
        continue;
      }
      const note = await this.vault.getNoteByPath(status.notePath);
      if (!note) {
        continue;
      }
      const parsed = TaskNoteParser.parse(note.content);
      if (!parsed) {
        continue;
      }
      const type = typeFromLabels(issue.labels);
      if (type === null) {
        continue;
      }
      items.push({
        issue,
        notePath: status.notePath,
        noteContent: note.content,
        type,
        lane: parsed.status,
        sliceLink: taskLinkFromAffiliation(
          parsed.affiliation,
          input.projectName,
        ),
      });
    }

    const slices = items.filter((item) => item.type === 'slice');
    const children = items.filter(
      (item) => item.type !== 'slice' && item.sliceLink !== null,
    );
    const unaffiliated = items.filter(
      (item) => item.type !== 'slice' && item.sliceLink === null,
    );

    const sliceTaskIdByNotePath = new Map<string, string>();
    for (const item of slices) {
      const taskId = await this.projectItem(
        item,
        { sectionId: sections[item.lane] ?? null, parentId: null },
        activeById,
        sections,
        input,
      );
      sliceTaskIdByNotePath.set(item.notePath, taskId);
    }

    for (const item of children) {
      const slicePath = sliceNotePath(input.projectName, item.sliceLink!);
      const parentId =
        sliceTaskIdByNotePath.get(slicePath) ??
        (await this.sliceTaskId(slicePath));
      if (parentId === null) {
        // The slice has no twin yet; the child waits for the next tick.
        continue;
      }
      await this.projectItem(
        item,
        { sectionId: null, parentId },
        activeById,
        sections,
        input,
      );
    }

    for (const item of unaffiliated) {
      await this.projectItem(
        item,
        { sectionId: sections[item.lane] ?? null, parentId: null },
        activeById,
        sections,
        input,
      );
    }
  }

  // Projects one task through the canonical pipeline and returns its twin id.
  private async projectItem(
    item: ProjectionItem,
    placement: { sectionId: string | null; parentId: string | null },
    activeById: Map<string, TodoistTaskData>,
    sections: Record<string, string>,
    input: SyncTodoistTasksInput,
  ): Promise<string> {
    const stored = await this.syncState.getTodoistState(item.notePath);
    const current = stored ? (activeById.get(stored.todoistId) ?? null) : null;

    const desired = this.desiredTask(item, placement);
    // A missing twin is a membership gap the writer must fill; only a present
    // twin whose remote moved (the absorber's pull) is left to the absorber.
    if (current !== null && stored !== null) {
      const verdict = this.verdictResolver.diff(
        desired,
        this.remoteTask(current, sections),
        stored,
      );
      if (verdict === 'pull') {
        return stored.todoistId;
      }
    }

    return this.applyToTodoist.executeTask({
      task: desired,
      current,
      projectId: input.projectId,
      sectionId: placement.sectionId,
      parentId: placement.parentId,
      labels: [item.type],
      description: item.issue.url,
      notePath: item.notePath,
      noteContent: item.noteContent,
      syncedAt: input.syncedAt,
    });
  }

  // The vault's to-dos projected onto their twins. Roots before nested children
  // so a child can find its parent's twin.
  private async projectToDos(
    input: SyncTodoistTasksInput,
    active: TodoistTaskData[],
  ): Promise<void> {
    const items = await this.collectToDos(input.projectName);
    if (items.length === 0) {
      return;
    }
    const activeById = new Map(active.map((task) => [task.id, task] as const));

    const roots = items.filter((item) => item.parentStem === null);
    const nested = items.filter((item) => item.parentStem !== null);

    const twinIdByStem = new Map<string, string>();
    for (const item of roots) {
      const id = await this.projectToDoItem(
        item,
        item.taskTwinId,
        activeById,
        input,
      );
      twinIdByStem.set(stemOf(item.notePath), id);
    }

    for (const item of nested) {
      const parentId =
        twinIdByStem.get(item.parentStem!) ??
        (await this.anchorId(
          `Projecten/${input.projectName}/todos/${item.parentStem}.md`,
        ));
      if (parentId === null) {
        // The parent to-do has no twin yet; the child waits for the next tick.
        continue;
      }
      await this.projectToDoItem(item, parentId, activeById, input);
    }
  }

  private async projectToDoItem(
    item: ToDoItem,
    parentId: string,
    activeById: Map<string, TodoistTaskData>,
    input: SyncTodoistTasksInput,
  ): Promise<string> {
    const parsed = ToDoNoteParser.parse(item.noteContent);
    const stored = await this.syncState.getTodoistState(item.notePath);
    const current = stored ? (activeById.get(stored.todoistId) ?? null) : null;

    // The vault owns to-do structure and content, so the diff is informational
    // here: the writer's field gate is authoritative and a remote completion
    // was already absorbed by ApplyTodoistCompletionAction.
    this.verdictResolver.diff(
      this.comparableToDo(item.title, parsed?.status ?? 'open', parentId),
      this.comparableToDo(
        current?.content ?? item.title,
        current?.isCompleted === true ? 'completed' : 'open',
        current?.parentId ?? parentId,
      ),
      this.comparableToDo(
        stored?.title ?? item.title,
        stored?.completed === true ? 'completed' : 'open',
        stored?.parent ?? parentId,
      ),
    );

    return this.applyToTodoist.executeToDo({
      todo: {
        todoistId: stored?.todoistId ?? '',
        notePath: item.notePath,
        projectName: input.projectName,
        taskLink: '',
        parentTodoLink: null,
        title: item.title,
        status: parsed?.status === 'completed' ? 'completed' : 'open',
      },
      current,
      projectId: input.projectId,
      parentId,
      notePath: item.notePath,
      noteContent: item.noteContent,
      syncedAt: input.syncedAt,
    });
  }

  // The vault's desired canonical task: the issue title, the note's lane and
  // affiliation and the lane-derived completion. The vault is the source of
  // truth; the issue supplies the title and the type.
  private desiredTask(
    item: ProjectionItem,
    placement: { sectionId: string | null; parentId: string | null },
  ): TaskData {
    return {
      url: item.issue.url,
      remoteId: 0,
      nodeId: '',
      todoistId: '',
      notePath: item.notePath,
      title: item.issue.title,
      body: '',
      status: item.lane,
      completed: item.lane === this.doneOptionName,
      parent: placement.parentId,
      labels: [item.type],
      updatedAt: '',
    };
  }

  // The remote twin as a canonical task, for the diff.
  private remoteTask(
    twin: TodoistTaskData,
    sections: Record<string, string>,
  ): TaskData {
    const section: TodoistSectionData = {
      id: twin.sectionId ?? '',
      projectId: twin.projectId,
      name: laneForSection(sections, twin.sectionId) ?? '',
    };
    return TodoistTaskMapper.parseTask(twin, section, null);
  }

  // A TaskData-shaped comparable for a to-do, so the same pure diff can read
  // it. The body is empty and the labels carry no content.
  private comparableToDo(
    title: string,
    status: string,
    parent: string,
  ): TaskData {
    return {
      url: '',
      remoteId: 0,
      nodeId: '',
      todoistId: '',
      notePath: '',
      title,
      body: '',
      status,
      completed: status === 'completed',
      parent,
      labels: [],
      updatedAt: '',
    };
  }

  // Every to-do linked from the checklist of a task note that carries a
  // `todoist` twin anchor. De-duplicated by note path.
  private async collectToDos(projectName: string): Promise<ToDoItem[]> {
    const items = new Map<string, ToDoItem>();
    const folder = `Projecten/${projectName}/taken`;

    for (const taskPath of await this.vault.listNotesInFolder(folder)) {
      const task = await this.vault.getNoteByPath(taskPath);
      if (!task) {
        continue;
      }
      const taskTwinId = anchorOf(task.content);
      // A task with no twin has nowhere to hang its to-dos.
      if (taskTwinId === null) {
        continue;
      }
      const body = splitFrontmatter(task.content)?.body ?? task.content;
      for (const entry of parseChecklist(body)) {
        if (entry.linkPath === undefined) {
          continue;
        }
        const todo = await this.vault.getNoteByPath(entry.linkPath);
        if (!todo) {
          continue;
        }
        const parsed = ToDoNoteParser.parse(todo.content);
        if (!parsed) {
          continue;
        }
        items.set(entry.linkPath, {
          notePath: entry.linkPath,
          noteContent: todo.content,
          title: entry.text,
          taskTwinId,
          parentStem: parentStemFromAffiliation(
            parsed.affiliation,
            projectName,
          ),
        });
      }
    }

    return [...items.values()];
  }

  // The slice's twin id, read from the slice note's `todoist` anchor.
  private async sliceTaskId(slicePath: string): Promise<string | null> {
    const note = await this.vault.getNoteByPath(slicePath);
    if (!note) {
      return null;
    }
    return anchorOf(note.content);
  }

  private async anchorId(notePath: string): Promise<string | null> {
    const note = await this.vault.getNoteByPath(notePath);
    return note === null ? null : anchorOf(note.content);
  }

  private readonly verdictResolver = new VerdictResolver();
}

// The type a tracked issue carries: the `type: ` prefix is stripped (dt-09).
function typeFromLabels(labels: string[]): string | null {
  const label = labels.find((candidate) => candidate.startsWith('type:'));
  if (label === undefined) {
    return null;
  }
  return label.slice('type:'.length).trim();
}

// A slice link is a note stem; the slice note lives in the project's taken
// folder beside its children.
function sliceNotePath(projectName: string, link: string): string {
  return `Projecten/${projectName}/taken/${stemOf(link)}.md`;
}

// A note's `todoist` frontmatter anchor, or null when absent or empty.
function anchorOf(content: string): string | null {
  const anchor = splitFrontmatter(content)?.fields.get('todoist') ?? '';
  return anchor === '' ? null : anchor;
}

// The affiliation lists the project first, then the parent task, then — when
// nested — the parent to-do. The second non-project link is the parent to-do's
// stem; a to-do with no parent link returns null.
function parentStemFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  const targets = affiliation
    .map(stripLink)
    .filter((target) => target !== projectName);
  return targets[1] ?? null;
}

// Whether two lane maps agree, so a settled project's bookkeeping is not
// rewritten on every tick.
function sameSections(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every((key) => a[key] === b[key]);
}
