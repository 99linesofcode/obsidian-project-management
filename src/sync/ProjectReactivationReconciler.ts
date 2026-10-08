export interface ProjectReactivationReconciler {
  reactivate(project: string): Promise<boolean>;
}
