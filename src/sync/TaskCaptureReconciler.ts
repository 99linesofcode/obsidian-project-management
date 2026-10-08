export interface TaskCaptureReconciler {
  capture(project: string): Promise<void>;
}
