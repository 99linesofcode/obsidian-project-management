export class TaskManagerTarget {
  readonly projectId: string;

  constructor(init: { projectId: string }) {
    this.projectId = init.projectId;
  }

  serialize(): string {
    return JSON.stringify({ projectId: this.projectId });
  }

  static parse(raw: string): TaskManagerTarget {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.projectId !== 'string') {
      throw new Error('task manager target must carry a project id');
    }
    return new TaskManagerTarget({ projectId: parsed.projectId });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
