import type { CanonicalField } from '../domain/canonicalField.js';
import type { CanonicalFieldWrite } from './data/CanonicalFieldWrite.js';
import type { CanonicalProject } from './data/CanonicalProject.js';
import type { CanonicalTask } from './data/CanonicalTask.js';
import type { ProjectAddressing } from './data/ProjectAddressing.js';

export interface MirrorPort {
  readProject(target: string): Promise<CanonicalProject | null>;
  renameProject(target: string, name: string): Promise<void>;
  setArchived(target: string, archived: boolean): Promise<void>;

  projectTime?(target: string): Promise<string | null>;

  readTasks(target: string): Promise<CanonicalTask[]>;
  readTask(handle: string): Promise<CanonicalTask | null>;
  createTask(target: string, task: CanonicalTask): Promise<CanonicalTask>;
  applyField(write: CanonicalFieldWrite): Promise<void>;
  deleteTask(handle: string): Promise<void>;

  resolveOrCreateProject(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing | null>;

  capture?(target: string): Promise<CanonicalTask[]>;

  materializesTodo?(): boolean;

  taskHandlesAreUrls?(): boolean;

  fieldTime?(handle: string, field: CanonicalField): Promise<string | null>;

  fetchComplete?(): boolean;

  lockTask?(handle: string): Promise<void>;
  unlockTask?(handle: string): Promise<void>;
}

export type ProjectSetupSurface = Pick<MirrorPort, 'resolveOrCreateProject'>;
