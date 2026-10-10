export class TaskManagerTarget {
  readonly projectId: string;

  constructor(init: { projectId: string }) {
    this.projectId = init.projectId;
  }

  static parse(raw: string): TaskManagerTarget {
    const projectId = raw.trim();
    if (projectId === '') {
      throw new Error('task manager target must carry a project id');
    }
    return new TaskManagerTarget({ projectId });
  }
}
