import type { CanonicalField } from '../../core/canonicalField.js';
import { CanonicalFieldWrite } from '../../core/data/CanonicalFieldWrite.js';
import { CanonicalProject } from '../../core/data/CanonicalProject.js';
import { CanonicalTask } from '../../core/data/CanonicalTask.js';
import type { MirrorAdapter } from '../../core/ports/MirrorAdapter.js';

export class ConformanceMirrorAdapter implements MirrorAdapter {
  private readonly tasks = new Map<string, CanonicalTask>();
  private readonly archived = new Map<string, boolean>();
  private readonly fieldTimes = new Map<
    string,
    Partial<Record<CanonicalField, string>>
  >();

  seed(task: CanonicalTask): void {
    this.tasks.set(task.handle, task);
  }

  seedProject(target: string, archived: boolean): void {
    this.archived.set(target, archived);
  }

  currentProject(target: string): CanonicalProject | null {
    return this.readProjectSync(target);
  }

  setFieldTime(
    handle: string,
    field: CanonicalField,
    time: string | null,
  ): void {
    const times = this.fieldTimes.get(handle) ?? {};
    if (time === null) {
      delete times[field];
    } else {
      times[field] = time;
    }
    this.fieldTimes.set(handle, times);
  }

  currentTask(handle: string): CanonicalTask | null {
    return this.tasks.get(handle) ?? null;
  }

  async readProject(target: string): Promise<CanonicalProject | null> {
    return this.readProjectSync(target);
  }

  async createProject(target: string, name: string): Promise<CanonicalProject> {
    return new CanonicalProject({ handle: target, name, archived: false });
  }

  async setArchived(target: string, archived: boolean): Promise<void> {
    this.archived.set(target, archived);
  }

  private readProjectSync(target: string): CanonicalProject {
    return new CanonicalProject({
      handle: target,
      name: target,
      archived: this.archived.get(target) ?? false,
    });
  }

  async readTasks(): Promise<CanonicalTask[]> {
    return [...this.tasks.values()];
  }

  async readTask(handle: string): Promise<CanonicalTask | null> {
    return this.tasks.get(handle) ?? null;
  }

  async createTask(_target: string, task: CanonicalTask): Promise<CanonicalTask> {
    this.tasks.set(task.handle, task);
    return task;
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    const task = this.tasks.get(write.handle);
    if (task === undefined) {
      return;
    }
    this.tasks.set(write.handle, applyToTask(task, write));
  }

  async deleteTask(handle: string): Promise<void> {
    this.tasks.delete(handle);
  }

  async capture(): Promise<CanonicalTask[]> {
    return [];
  }

  fetchComplete(): boolean {
    return true;
  }

  async fieldTime(
    handle: string,
    field: CanonicalField,
  ): Promise<string | null> {
    return this.fieldTimes.get(handle)?.[field] ?? null;
  }
}

function applyToTask(
  task: CanonicalTask,
  write: CanonicalFieldWrite,
): CanonicalTask {
  switch (write.field) {
    case 'title':
      return withTask(task, { title: write.value ?? '' });
    case 'body':
      return withTask(task, { body: write.value ?? '' });
    case 'Status':
      return withTask(task, { status: write.value ?? '' });
    case 'completion':
      return withTask(task, { completed: write.value === 'true' });
    case 'subtasks':
      return withTask(task, { parent: write.value });
    case 'label':
      return withTask(task, { labels: labelsFrom(write.value) });
    case 'identity':
      return task;
  }
}

function withTask(
  task: CanonicalTask,
  overrides: {
    title?: string;
    body?: string;
    status?: string;
    completed?: boolean;
    parent?: string | null;
    labels?: readonly string[];
  },
): CanonicalTask {
  return new CanonicalTask({
    handle: task.handle,
    entityId: task.entityId,
    title: overrides.title ?? task.title,
    body: overrides.body ?? task.body,
    status: overrides.status ?? task.status,
    completed: overrides.completed ?? task.completed,
    parent: overrides.parent !== undefined ? overrides.parent : task.parent,
    labels: overrides.labels ?? task.labels,
  });
}

function labelsFrom(value: string | null): readonly string[] {
  if (value === null || value === '') {
    return [];
  }
  return value.split(',');
}
