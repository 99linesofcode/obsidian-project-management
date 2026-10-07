import type { CanonicalFieldWrite } from '../data/CanonicalFieldWrite.js';
import type { CanonicalTask } from '../data/CanonicalTask.js';

export interface TaskSurfacePort {
  readTasks(target: string): Promise<CanonicalTask[]>;
  readTask(handle: string): Promise<CanonicalTask | null>;
  createTask(target: string, task: CanonicalTask): Promise<CanonicalTask>;
  applyField(write: CanonicalFieldWrite): Promise<void>;
  deleteTask(handle: string): Promise<void>;
}
