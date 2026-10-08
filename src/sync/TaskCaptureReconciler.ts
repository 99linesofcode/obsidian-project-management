export interface TaskCaptureReconciler {
  capture(project: string, syncedAt: string): Promise<void>;
}
