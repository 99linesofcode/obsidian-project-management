import type { TaskDataTransferObject } from './TaskDataTransferObject.js';

export interface MirrorItem {
  entityId: string;
  base: TaskDataTransferObject | null;
}
