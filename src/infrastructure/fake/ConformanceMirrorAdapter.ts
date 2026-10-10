import type { CanonicalField } from '../../core/canonicalField.js';
import { CanonicalFieldWrite } from '../../core/data/CanonicalFieldWrite.js';
import { CanonicalProject } from '../../core/data/CanonicalProject.js';
import { CanonicalTask } from '../../core/data/CanonicalTask.js';
import { CapturedProject } from '../../core/data/CapturedProject.js';
import { ProjectActivityObservation } from '../../core/data/ProjectActivityObservation.js';
import type { MirrorAdapter } from '../../core/ports/MirrorAdapter.js';

export class ConformanceMirrorAdapter implements MirrorAdapter {
  private readonly tasks = new Map<string, CanonicalTask>();
  private readonly archived = new Map<string, boolean>();
  private readonly names = new Map<string, string>();
  private readonly activities = new Map<string, ProjectActivityObservation>();
  private readonly projectTimes = new Map<string, string>();
  private readonly missingProjects = new Set<string>();
  private readonly absentProjects = new Set<string>();
  private readonly throwingProjects = new Set<string>();
  private readonly throwingTasks = new Set<string>();
  private readonly throwingLocks = new Set<string>();
  readonly createCalls: string[] = [];
  readonly createTaskCalls: string[] = [];
  readonly lockedHandles = new Set<string>();
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

  seedProjectName(target: string, name: string): void {
    this.names.set(target, name);
  }

  seedActivity(target: string, observation: ProjectActivityObservation): void {
    this.activities.set(target, observation);
  }

  seedMissingProject(target: string): void {
    this.missingProjects.add(target);
  }

  seedAbsentProject(target: string): void {
    this.absentProjects.add(target);
  }

  seedThrowingProject(target: string): void {
    this.throwingProjects.add(target);
  }

  seedThrowingTask(target: string): void {
    this.throwingTasks.add(target);
  }

  seedThrowingLock(handle: string): void {
    this.throwingLocks.add(handle);
  }

  setProjectTime(target: string, time: string | null): void {
    if (time === null) {
      this.projectTimes.delete(target);
    } else {
      this.projectTimes.set(target, time);
    }
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
    if (this.throwingProjects.has(target)) {
      throw new Error(`conformance: project ${target} read failed`);
    }
    if (this.missingProjects.has(target) || this.absentProjects.has(target)) {
      return null;
    }
    return this.readProjectSync(target);
  }

  async createProject(target: string, name: string): Promise<CanonicalProject> {
    this.createCalls.push(target);
    this.absentProjects.delete(target);
    this.names.set(target, name);
    return new CanonicalProject({ handle: target, name, archived: false });
  }

  async renameProject(target: string, name: string): Promise<void> {
    this.names.set(target, name);
  }

  async setArchived(target: string, archived: boolean): Promise<void> {
    this.archived.set(target, archived);
  }

  async archivedTime(target: string): Promise<string | null> {
    return this.projectTimes.get(target) ?? null;
  }

  async latestActivity(target: string): Promise<ProjectActivityObservation> {
    return (
      this.activities.get(target) ??
      new ProjectActivityObservation({
        changed: false,
        newestCreatedAt: null,
        etag: null,
      })
    );
  }

  private readProjectSync(target: string): CanonicalProject {
    return new CanonicalProject({
      handle: target,
      name: this.names.get(target) ?? target,
      archived: this.archived.get(target) ?? false,
    });
  }

  async readTasks(): Promise<CanonicalTask[]> {
    return [...this.tasks.values()];
  }

  async readTask(handle: string): Promise<CanonicalTask | null> {
    return this.tasks.get(handle) ?? null;
  }

  async createTask(
    target: string,
    task: CanonicalTask,
  ): Promise<CanonicalTask> {
    if (this.throwingTasks.has(target)) {
      throw new Error(`conformance: task creation for ${target} failed`);
    }
    this.createTaskCalls.push(task.handle);
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

  async lockTask(handle: string): Promise<void> {
    if (this.throwingLocks.has(handle)) {
      throw new Error(`conformance: lock for ${handle} failed`);
    }
    this.lockedHandles.add(handle);
  }

  async unlockTask(handle: string): Promise<void> {
    if (this.throwingLocks.has(handle)) {
      throw new Error(`conformance: unlock for ${handle} failed`);
    }
    this.lockedHandles.delete(handle);
  }

  async capture(): Promise<CanonicalTask[]> {
    return [];
  }

  async captureProjects(): Promise<CapturedProject[]> {
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
