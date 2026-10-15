export class TodoistTarget {
  readonly projectId: string;

  constructor(init: { projectId: string }) {
    this.projectId = init.projectId;
  }

  static parse(raw: string): TodoistTarget {
    return new TodoistTarget({ projectId: raw.trim() });
  }
}
