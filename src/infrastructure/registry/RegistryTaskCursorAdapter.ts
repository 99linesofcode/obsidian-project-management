import type { TaskCaptureCursorPort } from '../../core/ports/TaskCaptureCursorPort.js';

export interface TaskCursorStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export class RegistryTaskCursorAdapter implements TaskCaptureCursorPort {
  constructor(private readonly store: TaskCursorStore) {}

  read(project: string, slug: string): Promise<string | null> {
    return this.store.read(taskCursorKey(project, slug));
  }

  write(project: string, slug: string, handle: string): Promise<void> {
    return this.store.write(taskCursorKey(project, slug), handle);
  }
}

function taskCursorKey(project: string, slug: string): string {
  return `task:${project}:${slug}`;
}
