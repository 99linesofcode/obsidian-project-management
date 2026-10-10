export interface ProjectLifecycleReconciler {
  reconcile(project: string): Promise<{ frozen: boolean; wasFrozen: boolean }>;
}
