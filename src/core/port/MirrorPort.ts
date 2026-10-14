import type { CanonicalField } from '../domain/canonicalField.js';
import type { CanonicalFieldWrite } from './data/CanonicalFieldWrite.js';
import type { CanonicalProject } from './data/CanonicalProject.js';
import type { CanonicalTask } from './data/CanonicalTask.js';
import type { ProjectAddressing } from './data/ProjectAddressing.js';

// The external tool as the core's mirror — one collaborator, one surface. The
// project (read, rename, archive) and task surfaces are what every adapter
// carries, and so is project origination: every adapter resolves-or-creates the
// remote project a declared connection names. The capture, timestamp and
// locking surfaces are genuinely optional and are optional methods, so a caller
// checks presence rather than a capability string or a null-gated port slot.
// Designed for the core, never the provider's API.
export interface MirrorPort {
  readProject(target: string): Promise<CanonicalProject | null>;
  renameProject(target: string, name: string): Promise<void>;
  setArchived(target: string, archived: boolean): Promise<void>;

  // The core's need: read the archive fact's decisive time. Providing this
  // method asserts the tool exposes the project's own clock; a tool whose
  // archive fact carries no such time omits it, and the archive rung falls
  // through to the vault tie-break.
  projectTime?(target: string): Promise<string | null>;

  readTasks(target: string): Promise<CanonicalTask[]>;
  readTask(handle: string): Promise<CanonicalTask | null>;
  createTask(target: string, task: CanonicalTask): Promise<CanonicalTask>;
  applyField(write: CanonicalFieldWrite): Promise<void>;
  deleteTask(handle: string): Promise<void>;

  // The core's need: before a connection can mirror, its remote project must
  // exist and be addressable. Resolve the project named `name` under `target`
  // (by name alone when `target` is empty), creating it when absent, and return
  // the addressing the core records and writes through. Null when the remote
  // cannot be originated — a code host resolves an existing repository by name
  // and never creates one. Every adapter carries it, so no declared connection
  // is left unoriginated.
  resolveOrCreateProject(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing | null>;

  // The core's need: adopt remote-born tasks the vault does not hold yet. A tool
  // without a capture surface omits this method.
  capture?(target: string): Promise<CanonicalTask[]>;

  // The core's need: whether a `type:todo` becomes a standalone item on this
  // mirror. A code host does not — the parent's body carries the checklist line,
  // so the todo is untracked there — while a task manager does, as a subtask
  // under the parent. An adapter that omits the method is treated as
  // materializing todos.
  materializesTodo?(): boolean;

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
}

// The project-origination surface `EnsureProjectBoardAction` consumes: the
// uniform resolve-or-create every adapter carries.
export type ProjectSetupSurface = Pick<MirrorPort, 'resolveOrCreateProject'>;
