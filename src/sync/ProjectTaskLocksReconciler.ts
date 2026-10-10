export interface ProjectTaskLocksReconciler {
  reconcile(input: {
    project: string;
    frozen: boolean;
    wasFrozen: boolean;
  }): Promise<void>;
}
