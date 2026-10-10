import type { CanonicalFieldWrite } from '../application/data/CanonicalFieldWrite.js';
import type { CanonicalTask } from '../application/data/CanonicalTask.js';

export interface TaskSurfacePort {
  readTasks(target: string): Promise<CanonicalTask[]>;
  readTask(handle: string): Promise<CanonicalTask | null>;
  createTask(target: string, task: CanonicalTask): Promise<CanonicalTask>;
  applyField(write: CanonicalFieldWrite): Promise<void>;
  deleteTask(handle: string): Promise<void>;
}
