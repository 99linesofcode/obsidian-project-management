import type { CanonicalField } from '../../core/canonicalField.js';
import type { CanonicalFieldWrite } from '../../core/data/CanonicalFieldWrite.js';
import { CanonicalProject } from '../../core/data/CanonicalProject.js';
import { CanonicalTask } from '../../core/data/CanonicalTask.js';
import { CapturedProject } from '../../core/data/CapturedProject.js';
import type { MirrorAdapter } from '../../core/ports/MirrorAdapter.js';
import type {
  TaskManagerResponse,
  TaskManagerTransport,
} from './TaskManagerTransport.js';
import { TaskManagerTarget } from './TaskManagerTarget.js';

const COMPLETED_SINCE = '1970-01-01T00:00:00Z';

interface RawTask {
  id: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  content: string;
  description: string;
  labels: readonly string[];
  completed: boolean;
  updatedAt: string;
  completedAt: string | null;
}

interface RawSection {
  id: string;
  name: string;
}

export class TaskManagerMirrorAdapter implements MirrorAdapter {
  private readonly rawTarget: string;

  constructor(
    private readonly transport: TaskManagerTransport,
    target = '',
    private readonly now: () => Date = () => new Date(),
  ) {
    this.rawTarget = target;
  }

  private get target(): TaskManagerTarget {
    return TaskManagerTarget.parse(this.rawTarget);
  }

  async readProject(target: string): Promise<CanonicalProject | null> {
    const connection = TaskManagerTarget.parse(target);
    const response = await this.transport.get(
      `/projects/${connection.projectId}`,
    );
    if (response.status === 404) {
      return null;
    }
    return toCanonicalProject(requireRecord(response, 'read project'));
  }

  async createProject(target: string, name: string): Promise<CanonicalProject> {
    TaskManagerTarget.parse(target);
    const response = await this.transport.post(
      '/projects',
      JSON.stringify({ name }),
    );
    return toCanonicalProject(requireRecord(response, 'create project'));
  }

  async setArchived(target: string, archived: boolean): Promise<void> {
    const connection = TaskManagerTarget.parse(target);
    const action = archived ? 'archive' : 'unarchive';
    await this.postOk(
      `/projects/${connection.projectId}/${action}`,
      undefined,
      'set project archived',
    );
  }

  async archivedTime(_target: string): Promise<string | null> {
    return null;
  }

  async readTasks(target: string): Promise<CanonicalTask[]> {
    const connection = TaskManagerTarget.parse(target);
    const sections = await this.sections(connection.projectId);
    const tasks = await this.listTasks(connection.projectId);
    return tasks
      .filter((task) => hasTypeLabel(task.labels))
      .map((task) =>
        toCanonicalTask(task, sectionName(sections, task.sectionId)),
      );
  }

  async readTask(handle: string): Promise<CanonicalTask | null> {
    const response = await this.transport.get(`/tasks/${handle}`);
    if (response.status === 404) {
      return null;
    }
    const task = parseTask(requireRecord(response, 'read task'));
    const sections = await this.sections(task.projectId);
    return toCanonicalTask(task, sectionName(sections, task.sectionId));
  }

  async createTask(
    target: string,
    task: CanonicalTask,
  ): Promise<CanonicalTask> {
    const connection = TaskManagerTarget.parse(target);
    const sectionId =
      task.status === ''
        ? null
        : await this.sectionIdFor(connection.projectId, task.status);
    const body: Record<string, unknown> = {
      content: task.title,
      description: task.body,
      project_id: connection.projectId,
      labels: [...task.labels],
    };
    if (sectionId !== null) {
      body.section_id = sectionId;
    }
    if (task.parent !== null) {
      body.parent_id = task.parent;
    }
    const response = await this.transport.post('/tasks', JSON.stringify(body));
    const created = parseTask(requireRecord(response, 'create task'));
    if (task.completed) {
      await this.setCompleted(created.id, true);
    }
    return new CanonicalTask({
      handle: created.id,
      entityId: task.entityId,
      title: created.content,
      body: created.description,
      status: sectionId === null ? '' : task.status,
      completed: task.completed,
      parent: task.parent,
      labels: task.labels,
    });
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    switch (write.field) {
      case 'title':
        await this.postOk(
          `/tasks/${write.handle}`,
          { content: write.value ?? '' },
          'write title',
        );
        return;
      case 'body':
        await this.postOk(
          `/tasks/${write.handle}`,
          { description: write.value ?? '' },
          'write body',
        );
        return;
      case 'completion':
        await this.setCompleted(write.handle, write.value === 'true');
        return;
      case 'Status':
        await this.writeStatus(write);
        return;
      case 'subtasks':
        await this.writeParent(write);
        return;
      case 'label':
        await this.postOk(
          `/tasks/${write.handle}`,
          { labels: labelsFrom(write.value) },
          'write labels',
        );
        return;
      case 'identity':
        return;
    }
  }

  async deleteTask(handle: string): Promise<void> {
    const response = await this.transport.delete(`/tasks/${handle}`);
    if (response.status === 404) {
      return;
    }
    ensureSuccess(response);
  }

  async capture(target: string): Promise<CanonicalTask[]> {
    const connection = TaskManagerTarget.parse(target);
    const sections = await this.sections(connection.projectId);
    const tasks = dedupeById([
      ...(await this.listTasks(connection.projectId)),
      ...(await this.listCompletedTasks(connection.projectId)),
    ]);
    return tasks
      .filter((task) => !hasTypeLabel(task.labels))
      .map((task) =>
        toCanonicalTask(task, sectionName(sections, task.sectionId)),
      );
  }

  async captureProjects(): Promise<CapturedProject[]> {
    const raw = await this.getList('/projects');
    return raw.map(
      (project) =>
        new CapturedProject({
          name: stringOrEmpty(project.name),
          targets: [stringOrEmpty(project.id)],
          createdAt: nullableString(project.created_at),
        }),
    );
  }

  fetchComplete(): boolean {
    return true;
  }

  async fieldTime(
    handle: string,
    field: CanonicalField,
  ): Promise<string | null> {
    const response = await this.transport.get(`/tasks/${handle}`);
    if (response.status === 404) {
      return null;
    }
    const task = parseTask(requireRecord(response, 'read task time'));
    if (field === 'identity') {
      return null;
    }
    if (field === 'completion') {
      return task.completedAt;
    }
    return task.updatedAt === '' ? null : task.updatedAt;
  }

  private async writeStatus(write: CanonicalFieldWrite): Promise<void> {
    if (write.value === null) {
      throw new Error('task manager: cannot clear the Status section');
    }
    const sectionId = await this.sectionIdFor(
      this.target.projectId,
      write.value,
    );
    await this.postOk(
      `/tasks/${write.handle}/move`,
      { section_id: sectionId },
      'write Status',
    );
  }

  private async writeParent(write: CanonicalFieldWrite): Promise<void> {
    await this.postOk(
      `/tasks/${write.handle}/move`,
      { parent_id: write.value },
      'write subtasks',
    );
  }

  private async setCompleted(
    handle: string,
    completed: boolean,
  ): Promise<void> {
    const action = completed ? 'close' : 'reopen';
    await this.postOk(
      `/tasks/${handle}/${action}`,
      undefined,
      'set task completed',
    );
  }

  private async sectionIdFor(projectId: string, name: string): Promise<string> {
    const sections = await this.sections(projectId);
    const existing = sections.find((section) => section.name === name);
    if (existing !== undefined) {
      return existing.id;
    }
    const response = await this.transport.post(
      '/sections',
      JSON.stringify({ name, project_id: projectId }),
    );
    return parseSection(requireRecord(response, 'create section')).id;
  }

  private async sections(projectId: string): Promise<RawSection[]> {
    const raw = await this.getList(
      `/sections?project_id=${encodeURIComponent(projectId)}`,
    );
    return raw.map(parseSection);
  }

  private async listTasks(projectId: string): Promise<RawTask[]> {
    const raw = await this.getList(
      `/tasks?project_id=${encodeURIComponent(projectId)}`,
    );
    return raw.map(parseTask);
  }

  private async listCompletedTasks(projectId: string): Promise<RawTask[]> {
    const path =
      '/tasks/completed/by_completion_date' +
      `?since=${encodeURIComponent(COMPLETED_SINCE)}` +
      `&until=${encodeURIComponent(this.now().toISOString())}` +
      `&project_id=${encodeURIComponent(projectId)}`;
    const raw = await this.getList(path);
    return raw.map((task) => ({ ...parseTask(task), completed: true }));
  }

  private async getList(path: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    do {
      const separator = path.includes('?') ? '&' : '?';
      const pagePath =
        cursor === null
          ? path
          : `${path}${separator}cursor=${encodeURIComponent(cursor)}`;
      const response = await this.transport.get(pagePath);
      ensureSuccess(response);
      items.push(...extractList(response.json));
      cursor =
        isRecord(response.json) && typeof response.json.next_cursor === 'string'
          ? response.json.next_cursor
          : null;
    } while (cursor !== null);
    return items;
  }

  private async postOk(
    path: string,
    body: unknown,
    context: string,
  ): Promise<void> {
    const response = await this.transport.post(
      path,
      body === undefined ? '' : JSON.stringify(body),
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `task manager: ${context} failed with status ${response.status}`,
      );
    }
  }
}

function toCanonicalProject(raw: Record<string, unknown>): CanonicalProject {
  return new CanonicalProject({
    handle: stringOrEmpty(raw.id),
    name: stringOrEmpty(raw.name),
    archived: raw.is_archived === true,
  });
}

function toCanonicalTask(task: RawTask, status: string): CanonicalTask {
  return new CanonicalTask({
    handle: task.id,
    entityId: task.id,
    title: task.content,
    body: task.description,
    status,
    completed: task.completed,
    parent: task.parentId,
    labels: task.labels,
  });
}

function parseTask(raw: Record<string, unknown>): RawTask {
  return {
    id: typeof raw.task_id === 'string' ? raw.task_id : stringOrEmpty(raw.id),
    projectId: stringOrEmpty(raw.project_id),
    sectionId: nullableString(raw.section_id),
    parentId: nullableString(raw.parent_id),
    content: stringOrEmpty(raw.content),
    description: stringOrEmpty(raw.description),
    labels: stringList(raw.labels),
    completed: raw.checked === true,
    updatedAt: stringOrEmpty(raw.updated_at),
    completedAt: nullableString(raw.completed_at),
  };
}

function dedupeById(tasks: readonly RawTask[]): RawTask[] {
  const byId = new Map<string, RawTask>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }
  return [...byId.values()];
}

function parseSection(raw: Record<string, unknown>): RawSection {
  return {
    id: stringOrEmpty(raw.id),
    name: stringOrEmpty(raw.name),
  };
}

function sectionName(
  sections: readonly RawSection[],
  sectionId: string | null,
): string {
  if (sectionId === null) {
    return '';
  }
  return sections.find((section) => section.id === sectionId)?.name ?? '';
}

function hasTypeLabel(labels: readonly string[]): boolean {
  return labels.some((label) => label.startsWith('type:'));
}

function labelsFrom(value: string | null): readonly string[] {
  if (value === null || value === '') {
    return [];
  }
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '');
}

function extractList(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.filter(isRecord);
  }
  if (isRecord(json)) {
    const list = json.results ?? json.items;
    if (Array.isArray(list)) {
      return list.filter(isRecord);
    }
  }
  throw new Error('task manager: unexpected list response shape');
}

function requireRecord(
  response: TaskManagerResponse,
  context: string,
): Record<string, unknown> {
  ensureSuccess(response);
  if (!isRecord(response.json)) {
    throw new Error(`task manager: unexpected ${context} response shape`);
  }
  return response.json;
}

function ensureSuccess(response: TaskManagerResponse): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `task manager: request failed with status ${response.status}`,
    );
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
