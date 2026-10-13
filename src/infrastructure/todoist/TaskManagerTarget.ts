// The task manager connection's declared target. An empty target is valid: the
// remote project is then identified by the vault project's name (ORG-2), and
// the adapter resolves the project by name.
export class TaskManagerTarget {
  readonly projectId: string;

  constructor(init: { projectId: string }) {
    this.projectId = init.projectId;
  }

  static parse(raw: string): TaskManagerTarget {
    return new TaskManagerTarget({ projectId: raw.trim() });
  }
}
