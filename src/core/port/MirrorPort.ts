import type { CanonicalField } from '../domain/canonicalField.js';
import type { CanonicalFieldWrite } from './data/CanonicalFieldWrite.js';
import type { CanonicalProject } from './data/CanonicalProject.js';
import type { CanonicalTask } from './data/CanonicalTask.js';
import type { CapturedProject } from './data/CapturedProject.js';
import type { ProjectAddressing } from './data/ProjectAddressing.js';

// The external tool as the core's mirror — one collaborator, one surface. The
// project and task surfaces are what every adapter carries; the capture,
// timestamp, locking and project-origination surfaces are genuinely optional and
// are optional methods, so a caller checks presence rather than a capability
// string or a null-gated port slot. Designed for the core, never the provider's
// API.
export interface MirrorPort {
  readProject(target: string): Promise<CanonicalProject | null>;
  createProject(target: string, name: string): Promise<CanonicalProject>;
  renameProject(target: string, name: string): Promise<void>;
  setArchived(target: string, archived: boolean): Promise<void>;
  archivedTime(target: string): Promise<string | null>;

  readTasks(target: string): Promise<CanonicalTask[]>;
  readTask(handle: string): Promise<CanonicalTask | null>;
  createTask(target: string, task: CanonicalTask): Promise<CanonicalTask>;
  applyField(write: CanonicalFieldWrite): Promise<void>;
  deleteTask(handle: string): Promise<void>;

  // The core's need: adopt remote-born work the vault does not hold yet. A tool
  // without a capture surface omits these methods.
  capture?(target: string): Promise<CanonicalTask[]>;
  captureProjects?(): Promise<readonly CapturedProject[]>;

  // The core's need: read a mirror field's decisive time. Providing this method
  // asserts the times it returns are trustworthy; an adapter whose per-field
  // times are not decisive (or that cannot report one) omits it.
  fieldTime?(handle: string, field: CanonicalField): Promise<string | null>;

  // The core's need: know whether a mirror's read is a verified complete fetch,
  // so a mirror absence is deletion proof. An adapter without the surface omits
  // this method.
  fetchComplete?(): boolean;

  // The core's need: close a task's conversation thread while its project is
  // frozen, and reopen it on unfreeze. An adapter without the surface omits
  // these methods.
  lockTask?(handle: string): Promise<void>;
  unlockTask?(handle: string): Promise<void>;

  // The core's need: before a connection can mirror, its remote project must
  // exist and be addressable. Resolve the project named `name` under `target`
  // (by name alone when `target` is empty), creating it when absent, and return
  // the addressing the core records and writes through. A tool without a project
  // surface omits this method.
  resolveOrCreateProject?(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing>;
}

// The uniform project-origination surface every adapter exposes: resolve the
// remote project a declared connection names, creating it when absent. A tool
// without it is reached as null through ProjectSetupFactoryPort.
export type ProjectSetupSurface = Required<
  Pick<MirrorPort, 'resolveOrCreateProject'>
>;
