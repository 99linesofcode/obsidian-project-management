import type { CanonicalField } from '../../core/domain/canonicalField.js';
import { isRecord } from '../../core/domain/isRecord.js';
import {
  hasTypeLabel,
  labelsFromSequence,
} from '../../core/domain/note.js';
import { stringOrEmpty, stringOrNull } from '../../core/domain/strings.js';
import type { CanonicalFieldWrite } from '../../core/port/data/CanonicalFieldWrite.js';
import { CanonicalProject } from '../../core/port/data/CanonicalProject.js';
import { CanonicalTask } from '../../core/port/data/CanonicalTask.js';
import { ProjectAddressing } from '../../core/port/data/ProjectAddressing.js';
import type { MirrorPort } from '../../core/port/MirrorPort.js';
import type {
  TodoistResponse,
  TodoistTransport,
} from './TodoistTransport.js';
import { TodoistTarget } from './TodoistTarget.js';

const COMPLETED_SINCE = '1970-01-01T00:00:00Z';

const KIND_PALETTE: Readonly<Record<string, string>> = {
  slice: 'grape',
  pitch: 'orange',
  task: 'lime_green',
  bug: 'berry_red',
  chore: 'light_blue',
  todo: 'yellow',
};

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

interface RawLabel {
  id: string;
  name: string;
  color: string;
}

export class TodoistMirrorAdapter implements MirrorPort {
  private readonly rawTarget: string;
  private labelsCache: RawLabel[] | null = null;
  private sharedLabels: ReadonlySet<string> | null = null;

  constructor(
    private readonly transport: TodoistTransport,
    target = '',
    private readonly now: () => Date = () => new Date(),
  ) {
    this.rawTarget = target;
  }

  private get target(): TodoistTarget {
    return TodoistTarget.parse(this.rawTarget);
  }

  async readProject(target: string): Promise<CanonicalProject | null> {
    const connection = TodoistTarget.parse(target);
    const response = await this.transport.get(
      `/projects/${connection.projectId}`,
    );
    if (response.status === 404) {
      return null;
    }
    return toCanonicalProject(requireRecord(response, 'read project'));
  }

  async projectTime(target: string): Promise<string | null> {
    const connection = TodoistTarget.parse(target);
    const response = await this.transport.get(
      `/projects/${connection.projectId}`,
    );
    if (response.status === 404) {
      return null;
    }
    const project = requireRecord(response, 'read project time');
    return stringOrNull(project.updated_at);
  }

  async resolveOrCreateProject(
    target: string,
    name: string,
    _statusOptions: readonly string[],
  ): Promise<ProjectAddressing | null> {
    const projectId =
      target.trim() === ''
        ? await this.findOrCreateProjectId(name)
        : await this.resolveTargetProjectId(target, name);
    return new ProjectAddressing({
      projectHandle: projectId,
      statusFieldHandle: '',
      statusOptions: [],
      effectiveTarget: projectId,
    });
  }

  private async resolveTargetProjectId(
    target: string,
    name: string,
  ): Promise<string> {
    const connection = TodoistTarget.parse(target);
    const response = await this.transport.get(
      `/projects/${connection.projectId}`,
    );
    if (response.status !== 404) {
      requireRecord(response, 'read project');
      return connection.projectId;
    }
    return this.createProjectByName(name).then((project) => project.handle);
  }

  private async findOrCreateProjectId(name: string): Promise<string> {
    const existing = await this.findProjectIdByName(name);
    if (existing !== null) {
      return existing;
    }
    return this.createProjectByName(name).then((project) => project.handle);
  }

  private async findProjectIdByName(name: string): Promise<string | null> {
    const raw = await this.getList('/projects');
    const match = raw.find((project) => stringOrEmpty(project.name) === name);
    return match === undefined ? null : stringOrEmpty(match.id);
  }

  private async createProjectByName(name: string): Promise<CanonicalProject> {
    const response = await this.transport.post(
      '/projects',
      JSON.stringify({ name }),
    );
    return toCanonicalProject(requireRecord(response, 'create project'));
  }

  async setArchived(target: string, archived: boolean): Promise<void> {
    const connection = TodoistTarget.parse(target);
    const action = archived ? 'archive' : 'unarchive';
    await this.postOk(
      `/projects/${connection.projectId}/${action}`,
      undefined,
      'set project archived',
    );
  }

  async renameProject(target: string, name: string): Promise<void> {
    const connection = TodoistTarget.parse(target);
    await this.postOk(
      `/projects/${connection.projectId}`,
      { name },
      'rename project',
    );
  }

  async readTasks(target: string): Promise<CanonicalTask[]> {
    const connection = TodoistTarget.parse(target);
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
    if (!hasTypeLabel(task.labels)) {
      return null;
    }
    const sections = await this.sections(task.projectId);
    return toCanonicalTask(task, sectionName(sections, task.sectionId));
  }

  async createTask(
    target: string,
    task: CanonicalTask,
  ): Promise<CanonicalTask> {
    const connection = TodoistTarget.parse(target);
    const sectionId =
      task.status === ''
        ? null
        : await this.sectionIdFor(connection.projectId, task.status);
    const labels = [...task.labels];
    await this.ensureKindLabels(labels);
    const body: Record<string, unknown> = {
      content: task.title,
      description: task.body,
      project_id: connection.projectId,
      labels,
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
      case 'label': {
        const labels = labelsFromSequence(write.value);
        await this.ensureKindLabels(labels);
        await this.postOk(
          `/tasks/${write.handle}`,
          { labels },
          'write labels',
        );
        return;
      }
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
    const connection = TodoistTarget.parse(target);
    const sections = await this.sections(connection.projectId);
    const tasks = dedupeById([
      ...(await this.listTasks(connection.projectId)),
      ...(await this.listCompletedTasks(connection.projectId)),
    ]);
    return tasks.map((task) =>
      toCanonicalTask(task, sectionName(sections, task.sectionId)),
    );
  }

  materializesTodo(): boolean {
    return true;
  }

  taskHandlesAreUrls(): boolean {
    return false;
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

  private async ensureKindLabels(labels: readonly string[]): Promise<void> {
    for (const label of labels) {
      const colour = KIND_PALETTE[kindOf(label)];
      if (colour !== undefined) {
        await this.ensureLabel(label, colour);
      }
    }
  }

  private async ensureLabel(name: string, colour: string): Promise<void> {
    const existing = await this.findLabel(name);
    if (existing === null) {
      await this.createLabel(name, colour);
      return;
    }
    if (normaliseIdentifier(existing.color) === normaliseIdentifier(colour)) {
      return;
    }
    if (await this.isSharedLabel(name)) {
      return;
    }
    await this.recolourLabel(existing, colour);
  }

  private async createLabel(name: string, colour: string): Promise<void> {
    await this.postOk('/labels', { name, color: colour }, 'create label');
    this.labelsCache?.push({ id: '', name, color: colour });
  }

  private async recolourLabel(label: RawLabel, colour: string): Promise<void> {
    await this.postOk(
      `/labels/${label.id}`,
      { color: colour },
      'recolour label',
    );
    label.color = colour;
  }

  private async isSharedLabel(name: string): Promise<boolean> {
    return (await this.sharedLabelNames()).has(normaliseIdentifier(name));
  }

  private async sharedLabelNames(): Promise<ReadonlySet<string>> {
    if (this.sharedLabels === null) {
      const names = await this.getStringList('/labels/shared');
      this.sharedLabels = new Set(names.map(normaliseIdentifier));
    }
    return this.sharedLabels;
  }

  private async findLabel(name: string): Promise<RawLabel | null> {
    const normalised = normaliseIdentifier(name);
    const labels = await this.accountLabels();
    return (
      labels.find((label) => normaliseIdentifier(label.name) === normalised) ??
      null
    );
  }

  private async accountLabels(): Promise<RawLabel[]> {
    if (this.labelsCache === null) {
      this.labelsCache = (await this.getList('/labels')).map(parseLabel);
    }
    return this.labelsCache;
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
    return this.getItems(path, isRecord);
  }

  private async getStringList(path: string): Promise<string[]> {
    return this.getItems(
      path,
      (item): item is string => typeof item === 'string',
    );
  }

  private async getItems<T>(
    path: string,
    keep: (item: unknown) => item is T,
  ): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    do {
      const separator = path.includes('?') ? '&' : '?';
      const pagePath =
        cursor === null
          ? path
          : `${path}${separator}cursor=${encodeURIComponent(cursor)}`;
      const response = await this.transport.get(pagePath);
      ensureSuccess(response);
      items.push(...extractItems(response.json).filter(keep));
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
    sectionId: stringOrNull(raw.section_id),
    parentId: stringOrNull(raw.parent_id),
    content: stringOrEmpty(raw.content),
    description: stringOrEmpty(raw.description),
    labels: stringList(raw.labels),
    completed: raw.checked === true,
    updatedAt: stringOrEmpty(raw.updated_at),
    completedAt: stringOrNull(raw.completed_at),
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

function parseLabel(raw: Record<string, unknown>): RawLabel {
  return {
    id: stringOrEmpty(raw.id),
    name: stringOrEmpty(raw.name),
    color: stringOrEmpty(raw.color),
  };
}

function kindOf(label: string): string {
  return label.startsWith('type:') ? label.slice('type:'.length).trim() : '';
}

function normaliseIdentifier(value: string): string {
  return value.trim().toLowerCase();
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

function extractItems(json: unknown): unknown[] {
  if (Array.isArray(json)) {
    return json;
  }
  if (isRecord(json)) {
    const list = json.results ?? json.items;
    if (Array.isArray(list)) {
      return list;
    }
  }
  throw new Error('task manager: unexpected list response shape');
}

function requireRecord(
  response: TodoistResponse,
  context: string,
): Record<string, unknown> {
  ensureSuccess(response);
  if (!isRecord(response.json)) {
    throw new Error(`task manager: unexpected ${context} response shape`);
  }
  return response.json;
}

function ensureSuccess(response: TodoistResponse): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `task manager: request failed with status ${response.status}`,
    );
  }
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}
