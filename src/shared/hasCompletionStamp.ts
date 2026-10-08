import type { TaskData } from './TaskData.js';

export function hasCompletionStamp(base: TaskData | null): boolean {
  return base !== null && base.completedAt !== null;
}
