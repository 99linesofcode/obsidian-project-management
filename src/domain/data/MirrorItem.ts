import type { TaskData } from './TaskData.js';

export interface MirrorItem {
  entityId: string;
  base: TaskData | null;
}
