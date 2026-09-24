import { hasTypeLabel } from '../Labels/hasTypeLabel.js';
import { hash } from '../Notes/hash.js';
import { splitFrontmatter } from '../Notes/splitFrontmatter.js';
import { stampFrontmatterField } from '../Notes/stampFrontmatterField.js';
import { TaskNoteParser } from '../Notes/TaskNoteParser.js';
import type { TaskData } from '../DataTransferObjects/TaskData.js';
import type { TodoistTaskData } from '../DataTransferObjects/TodoistTaskData.js';
import type { ProjectManagementPort } from '../Ports/ProjectManagementPort.js';
import type { SyncStatePort } from '../Ports/SyncStatePort.js';
import type { TaskManagerPort } from '../Ports/TaskManagerPort.js';
import type { VaultPort } from '../Ports/VaultPort.js';
import type { EnsureTodoistSectionsAction } from './EnsureTodoistSectionsAction.js';

export interface ProjectTasksToTodoistInput {
  projectName: string;
  projectId: string;
  syncedAt: string;
}

// One tracked issue resolved to its vault note: the issue carries the type
// label and the title, the note carries the lane (its status) and the slice
// affiliation. The vault is the source of truth for the shape; the issue is the
// source of the type, which the note does not carry.
interface ProjectionItem {
  issue: TaskData;
  notePath: string;
  noteContent: string;
  type: string;
  lane: string;
  sliceLink: string | null;
}

// Where a twin sits: a top-level task in its lane section, or a subtask under
// its slice. A subtask inherits its parent's section (dt-02), so it is placed
// by parentId alone.
interface Placement {
  sectionId: string | null;
  parentId: string | null;
}

// The projection's desired shape, the thing the snapshot hash covers.
interface DesiredTask {
  content: string;
  labels: string[];
  sectionId: string | null;
  parentId: string | null;
  isCompleted: boolean;
}

// UC: project the vault's tracked tasks onto their Todoist twins (t3). The
// vault is the source of truth: the note's lane selects the section, its
// affiliation selects the slice parent, and its status selects completion. The
// GitHub issue supplies the type label (the note does not carry it) and the
// title. Slices are projected first so their children can find the parent twin;
// then the children, then the unaffiliated top-level tasks. Every write stamps
// the item's snapshot hash (dt-08) so t5 can tell a remote change from an echo.
//
// Idempotence: the desired shape is compared to the live twin before writing,
// so a settled project performs no writes. Label drift is overwritten (dt-09):
// the label set is derived, never free-form.
export class ProjectTasksToTodoistAction {
  constructor(
    private readonly taskManager: TaskManagerPort,
    private readonly projectManagement: ProjectManagementPort,
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly ensureSections: EnsureTodoistSectionsAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ProjectTasksToTodoistInput): Promise<void> {
    const identity = await this.syncState.getIdentity(input.projectName);
    // A project without a GitHub attach has no typed issues to project; its
    // Todoist project stays empty (dt-03).
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

    // The same tracked set the GitHub half materializes: every typed issue.
    const issues = (
      await this.projectManagement.fetchTrackedIssues(identity.repoUrl)
    ).filter((issue) => hasTypeLabel(issue.labels));

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
        sliceLink: sliceLinkFromAffiliation(
          parsed.affiliation,
          input.projectName,
        ),
      });
    }

    const active = await this.taskManager.fetchActiveTasks(input.projectId);
    const activeById = new Map(active.map((task) => [task.id, task]));

    const slices = items.filter((item) => item.type === 'slice');
    const children = items.filter(
      (item) => item.type !== 'slice' && item.sliceLink !== null,
    );
    const unaffiliated = items.filter(
      (item) => item.type !== 'slice' && item.sliceLink === null,
    );

    // Slices first: a child needs its slice's twin id to nest under.
    const sliceTaskIdByNotePath = new Map<string, string>();
    for (const item of slices) {
      const taskId = await this.projectItem(
        item,
        { sectionId: sections[item.lane] ?? null, parentId: null },
        activeById,
        input.projectId,
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
        input.projectId,
      );
    }

    for (const item of unaffiliated) {
      await this.projectItem(
        item,
        { sectionId: sections[item.lane] ?? null, parentId: null },
        activeById,
        input.projectId,
      );
    }
  }

  // Projects one item and returns its Todoist task id. A settled twin (the
  // desired shape already matches) is left untouched; otherwise only the
  // drifted fields are written, and the snapshot is stamped after the write.
  private async projectItem(
    item: ProjectionItem,
    placement: Placement,
    activeById: Map<string, TodoistTaskData>,
    projectId: string,
  ): Promise<string> {
    const desired: DesiredTask = {
      content: item.issue.title,
      labels: [item.type],
      sectionId: placement.sectionId,
      parentId: placement.parentId,
      isCompleted: item.lane === this.doneOptionName,
    };
    const stored = await this.syncState.getTodoistState(item.notePath);
    const current = stored ? activeById.get(stored.todoistId) : undefined;

    if (stored && current && matches(desired, current)) {
      return stored.todoistId;
    }

    if (!stored) {
      await this.taskManager.ensureLabel(item.type);
      const created = await this.taskManager.createTask({
        projectId,
        ...(placement.sectionId !== null
          ? { sectionId: placement.sectionId }
          : {}),
        ...(placement.parentId !== null
          ? { parentId: placement.parentId }
          : {}),
        content: desired.content,
        labels: desired.labels,
        description: item.issue.url,
      });
      await stampFrontmatterField(
        this.vault,
        item.notePath,
        item.noteContent,
        'todoist',
        created.id,
      );
      if (desired.isCompleted) {
        await this.taskManager.setTaskCompleted(created.id, true);
      }
      await this.stampState(item.notePath, created.id, desired);
      return created.id;
    }

    const id = stored.todoistId;
    // A twin missing from the active set is completed (or gone). A completed
    // twin is already in step; an active vault reopens it. The content and
    // labels are brought in step on the next tick, once the twin is active.
    if (!current) {
      if (!desired.isCompleted) {
        await this.taskManager.setTaskCompleted(id, false);
      }
      await this.stampState(item.notePath, id, desired);
      return id;
    }

    if (
      current.content !== desired.content ||
      !sameLabels(current.labels, desired.labels)
    ) {
      await this.taskManager.ensureLabel(item.type);
      await this.taskManager.updateTask(id, {
        content: desired.content,
        labels: desired.labels,
      });
    }
    if (desired.sectionId !== null && current.sectionId !== desired.sectionId) {
      await this.taskManager.moveTask(id, { sectionId: desired.sectionId });
    }
    if (desired.parentId !== null && current.parentId !== desired.parentId) {
      await this.taskManager.moveTask(id, { parentId: desired.parentId });
    }
    if (desired.isCompleted) {
      await this.taskManager.setTaskCompleted(id, true);
    }
    await this.stampState(item.notePath, id, desired);
    return id;
  }

  // The slice's twin id, read from the slice note's `todoist` anchor. Used when
  // the slice was not part of this tick's tracked set but its twin already
  // exists from an earlier sync.
  private async sliceTaskId(slicePath: string): Promise<string | null> {
    const note = await this.vault.getNoteByPath(slicePath);
    if (!note) {
      return null;
    }
    const anchor = splitFrontmatter(note.content)?.fields.get('todoist') ?? '';
    return anchor === '' ? null : anchor;
  }

  private async stampState(
    notePath: string,
    todoistId: string,
    desired: DesiredTask,
  ): Promise<void> {
    await this.syncState.setTodoistState(notePath, {
      todoistId,
      notePath,
      lastSyncedHash: snapshotHash(desired),
    });
  }
}

// The type a tracked issue carries: the `type: ` prefix is stripped (dt-09), so
// `type: slice` becomes the label `slice`.
function typeFromLabels(labels: string[]): string | null {
  const label = labels.find((candidate) => candidate.startsWith('type:'));
  if (label === undefined) {
    return null;
  }
  return label.slice('type:'.length).trim();
}

// The affiliation lists the project first, then the slice; the first link that
// is not the project is the slice. A link's display alias (after `|`) is
// stripped, so `[[40-slice-1|Slice 1]]` resolves to the note stem.
function sliceLinkFromAffiliation(
  affiliation: string[],
  projectName: string,
): string | null {
  for (const link of affiliation) {
    const target = link
      .replace(/^\[\[/, '')
      .replace(/\]\]$/, '')
      .split('|')[0]!
      .trim();
    if (target !== projectName) {
      return target;
    }
  }
  return null;
}

// A slice link is a note stem; the slice note lives in the project's taken
// folder beside its children.
function sliceNotePath(projectName: string, link: string): string {
  const stem = (link.split('/').pop() ?? link).replace(/\.md$/, '');
  return `Projecten/${projectName}/taken/${stem}.md`;
}

// The snapshot hash (dt-08): content, labels, section, parent and completion.
// Labels are sorted so their order never reads as a change. A subtask's section
// is inherited from its parent (dt-02), so it is not a controlled field and
// enters the hash as empty — the parent's own snapshot carries the section.
function snapshotHash(desired: DesiredTask): string {
  return hash(
    [
      desired.content,
      [...desired.labels].sort().join(','),
      desired.sectionId ?? '',
      desired.parentId ?? '',
      desired.isCompleted ? '1' : '0',
    ].join('\n'),
  );
}

// Whether the live twin already carries the desired shape. A null desired
// section or parent means the field is not controlled here (a subtask inherits
// its section), so it is not compared.
function matches(desired: DesiredTask, current: TodoistTaskData): boolean {
  if (current.content !== desired.content) {
    return false;
  }
  if (!sameLabels(current.labels, desired.labels)) {
    return false;
  }
  if (desired.sectionId !== null && current.sectionId !== desired.sectionId) {
    return false;
  }
  if (desired.parentId !== null && current.parentId !== desired.parentId) {
    return false;
  }
  return current.isCompleted === desired.isCompleted;
}

function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((label, index) => label === sortedB[index]);
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
