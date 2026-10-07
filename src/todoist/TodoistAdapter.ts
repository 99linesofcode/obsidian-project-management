import { requestUrl } from 'obsidian';
import { isRecord } from '../shared/isRecord.js';
import type { CreateTodoistTaskData } from './CreateTodoistTaskData.js';
import type { TodoistProjectData } from './TodoistProjectData.js';
import type { TodoistSectionData } from './TodoistSectionData.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import type { TaskManagerPort } from '../shared/TaskManagerPort.js';

export interface TodoistTransport {
  get(path: string): Promise<TodoistResponse>;
  post(path: string, body: string): Promise<TodoistResponse>;
  delete(path: string): Promise<TodoistResponse>;
}

export interface TodoistResponse {
  status: number;
  json: unknown;
}

const BASE_URL = 'https://api.todoist.com/api/v1';

export function createTodoistTransport(token: string): TodoistTransport {
  const request = async (
    method: string,
    path: string,
    body?: string,
  ): Promise<TodoistResponse> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await requestUrl({
      url: `${BASE_URL}${path}`,
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      throw: false,
    });
    const text = response.text;
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, json };
  };
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    delete: (path) => request('DELETE', path),
  };
}

export class TodoistAdapter implements TaskManagerPort {
  constructor(
    private readonly transport: TodoistTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchProjects(): Promise<TodoistProjectData[]> {
    const raw = await this.getList('/projects');
    return raw.map((project) => this.mapProject(project));
  }

  async fetchProject(id: string): Promise<TodoistProjectData | null> {
    const response = await this.transport.get(`/projects/${id}`);
    if (response.status === 404) {
      return null;
    }
    return this.mapProject(this.requireRecord(response, 'fetch project'));
  }

  async createProject(name: string): Promise<TodoistProjectData> {
    const response = await this.transport.post(
      '/projects',
      JSON.stringify({ name }),
    );
    return this.mapProject(this.requireRecord(response, 'create project'));
  }

  async updateProject(id: string, name: string): Promise<void> {
    await this.postOk(`/projects/${id}`, { name }, 'update project');
  }

  async setProjectArchived(id: string, archived: boolean): Promise<void> {
    const action = archived ? 'archive' : 'unarchive';
    await this.postOk(
      `/projects/${id}/${action}`,
      undefined,
      'archive project',
    );
  }

  async fetchSections(projectId: string): Promise<TodoistSectionData[]> {
    const raw = await this.getList(
      `/sections?project_id=${encodeURIComponent(projectId)}`,
    );
    return raw.map((section) => this.mapSection(section));
  }

  async createSection(
    projectId: string,
    name: string,
  ): Promise<TodoistSectionData> {
    const response = await this.transport.post(
      '/sections',
      JSON.stringify({ name, project_id: projectId }),
    );
    return this.mapSection(this.requireRecord(response, 'create section'));
  }

  async updateSection(id: string, name: string): Promise<void> {
    await this.postOk(`/sections/${id}`, { name }, 'update section');
  }

  async fetchActiveTasks(projectId: string): Promise<TodoistTaskData[]> {
    const raw = await this.getList(
      `/tasks?project_id=${encodeURIComponent(projectId)}`,
    );
    return raw.map((task) => this.mapTask(task, false));
  }

  async fetchCompletedTasks(
    projectId: string,
    since: string,
  ): Promise<TodoistTaskData[]> {
    const until = this.now().toISOString();
    const path =
      `/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}` +
      `&until=${encodeURIComponent(until)}` +
      `&project_id=${encodeURIComponent(projectId)}`;
    const raw = await this.getList(path);
    return raw.map((task) => this.mapTask(task, true));
  }

  async createTask(input: CreateTodoistTaskData): Promise<TodoistTaskData> {
    const body: Record<string, unknown> = {
      content: input.content,
      project_id: input.projectId,
    };
    if (input.sectionId !== undefined) {
      body.section_id = input.sectionId;
    }
    if (input.parentId !== undefined) {
      body.parent_id = input.parentId;
    }
    if (input.labels !== undefined) {
      body.labels = input.labels;
    }
    const response = await this.transport.post('/tasks', JSON.stringify(body));
    return this.mapTask(this.requireRecord(response, 'create task'), false);
  }

  async updateTask(
    id: string,
    input: { content: string; labels: string[] },
  ): Promise<void> {
    await this.postOk(`/tasks/${id}`, input, 'update task');
  }

  async moveTask(
    id: string,
    to: { sectionId?: string; parentId?: string | null },
  ): Promise<void> {
    if (to.parentId === null) {
      await this.postOk(
        `/tasks/${id}/move`,
        {
          parent_id: null,
          ...(to.sectionId === undefined ? {} : { section_id: to.sectionId }),
        },
        'move task',
      );
      return;
    }
    if (to.sectionId !== undefined && to.parentId === undefined) {
      await this.postOk(
        `/tasks/${id}/move`,
        { section_id: to.sectionId },
        'move task',
      );
      return;
    }
    if (to.parentId !== undefined && to.sectionId === undefined) {
      await this.postOk(
        `/tasks/${id}/move`,
        { parent_id: to.parentId },
        'move task',
      );
      return;
    }
    throw new Error(
      'TodoistAdapter: moveTask needs exactly one of sectionId or parentId',
    );
  }

  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    const action = completed ? 'close' : 'reopen';
    await this.postOk(
      `/tasks/${id}/${action}`,
      undefined,
      'set task completed',
    );
  }

  async deleteTask(id: string): Promise<void> {
    const response = await this.transport.delete(`/tasks/${id}`);
    if (response.status === 404) {
      return;
    }
    this.assertOk(response, 'delete task');
  }

  async ensureLabel(name: string): Promise<void> {
    const labels = await this.getList('/labels');
    const exists = labels.some(
      (label) => isRecord(label) && label.name === name,
    );
    if (exists) {
      return;
    }
    await this.postOk('/labels', { name }, 'create label');
  }

  private mapProject(raw: Record<string, unknown>): TodoistProjectData {
    return {
      id: this.stringField(raw, 'id'),
      name: this.stringField(raw, 'name'),
      isArchived: raw.is_archived === true,
      createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
    };
  }

  private mapSection(raw: Record<string, unknown>): TodoistSectionData {
    return {
      id: this.stringField(raw, 'id'),
      projectId: this.stringField(raw, 'project_id'),
      name: this.stringField(raw, 'name'),
    };
  }

  private mapTask(
    raw: Record<string, unknown>,
    completed: boolean,
  ): TodoistTaskData {
    const id =
      typeof raw.task_id === 'string'
        ? raw.task_id
        : this.stringField(raw, 'id');
    return {
      id,
      projectId: this.stringField(raw, 'project_id'),
      sectionId: this.nullableString(raw.section_id),
      parentId: this.nullableString(raw.parent_id),
      content: this.stringField(raw, 'content'),
      labels: this.stringList(raw.labels),
      isCompleted: completed || raw.checked === true,
      addedAt: this.stringOrEmpty(raw.added_at),
      updatedAt: this.stringOrEmpty(raw.updated_at),
      completedAt:
        typeof raw.completed_at === 'string' ? raw.completed_at : null,
    };
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
      this.assertOk(response, 'list request');
      items.push(...this.extractList(response.json));
      cursor =
        isRecord(response.json) && typeof response.json.next_cursor === 'string'
          ? response.json.next_cursor
          : null;
    } while (cursor !== null);
    return items;
  }

  private extractList(json: unknown): Record<string, unknown>[] {
    if (Array.isArray(json)) {
      return json.filter(isRecord);
    }
    if (isRecord(json)) {
      const list = json.results ?? json.items;
      if (Array.isArray(list)) {
        return list.filter(isRecord);
      }
    }
    throw new Error('TodoistAdapter: unexpected list response shape');
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
    this.assertOk(response, context);
  }

  private requireRecord(
    response: TodoistResponse,
    context: string,
  ): Record<string, unknown> {
    this.assertOk(response, context);
    if (!isRecord(response.json)) {
      throw new Error(`TodoistAdapter: unexpected ${context} response shape`);
    }
    return response.json;
  }

  private assertOk(response: TodoistResponse, context: string): void {
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `TodoistAdapter: ${context} failed with status ${response.status}`,
      );
    }
  }

  private stringField(raw: Record<string, unknown>, key: string): string {
    const value = raw[key];
    if (typeof value !== 'string') {
      throw new Error(`TodoistAdapter: response is missing ${key}`);
    }
    return value;
  }

  private nullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private stringOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private stringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
  }
}
