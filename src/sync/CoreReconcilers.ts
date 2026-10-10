import type { ProjectLifecycleReconciler } from './ProjectLifecycleReconciler.js';
import type { ProjectReactivationReconciler } from './ProjectReactivationReconciler.js';
import type { ProjectTaskLocksReconciler } from './ProjectTaskLocksReconciler.js';
import type { TaskCaptureReconciler } from './TaskCaptureReconciler.js';
import type { TaskFieldReconciler } from './TaskFieldReconciler.js';

// The five core reconcilers the chain drives; the composition root assembles
// each from an assembled core action.
export interface CoreReconcilers {
  taskFields: TaskFieldReconciler;
  lifecycle: ProjectLifecycleReconciler;
  taskLocks: ProjectTaskLocksReconciler;
  reactivation: ProjectReactivationReconciler;
  taskCapture: TaskCaptureReconciler;
}
