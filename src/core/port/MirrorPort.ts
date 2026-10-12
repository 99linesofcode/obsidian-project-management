import type { CanonicalField } from '../domain/canonicalField.js';
import type { CanonicalFieldWrite } from './data/CanonicalFieldWrite.js';
import type { CanonicalProject } from './data/CanonicalProject.js';
import type { CanonicalTask } from './data/CanonicalTask.js';
import type { CapturedProject } from './data/CapturedProject.js';
import type { ProjectActivityObservation } from './data/ProjectActivityObservation.js';
import type { ProjectAddressing } from './data/ProjectAddressing.js';
import type { ProjectCandidate } from './data/ProjectCandidate.js';
import type { ProjectDiscovery } from './data/ProjectDiscovery.js';
import type { ProjectSummary } from './data/ProjectSummary.js';

// The external tool as the core's mirror — one collaborator, one surface. The
// project and task surfaces are what every adapter carries; the capture,
// timestamp, locking, activity and setup surfaces are genuinely optional and
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

  capture(target: string): Promise<CanonicalTask[]>;
  captureProjects(): Promise<readonly CapturedProject[]>;

  // The core's need: know a mirror field's decisive time. An adapter without
  // trustworthy per-field timestamps omits this method.
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

  // The core's need: notice that new work appeared on a frozen project's
  // mirror. An adapter without the surface omits this method.
  latestActivity?(
    target: string,
    etag?: string,
  ): Promise<ProjectActivityObservation>;

  // The core's need: before a connection can mirror, its project must be
  // resolved — the projects the target carries, one created or adopted with the
  // core's Status vocabulary, and the addressing the core writes through. A
  // tool without a setup surface omits these methods.
  discoverProjects?(target: string): Promise<ProjectDiscovery>;
  readProjectAddressing?(
    project: ProjectSummary,
  ): Promise<ProjectAddressing | null>;
  createProjectWithStatus?(
    target: string,
    name: string,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing>;
  adoptProject?(
    target: string,
    project: ProjectSummary,
    statusOptions: readonly string[],
  ): Promise<ProjectAddressing>;
  listProjects?(): Promise<readonly ProjectCandidate[]>;
}

// The setup surface a code host exposes, projected from MirrorPort. Callers
// reach it through ProjectSetupFactoryPort, which returns null for a tool
// without setup.
export type ProjectSetupSurface = Required<
  Pick<
    MirrorPort,
    | 'discoverProjects'
    | 'readProjectAddressing'
    | 'createProjectWithStatus'
    | 'adoptProject'
    | 'listProjects'
  >
>;
