export class CanonicalTask {
  readonly handle: string;
  readonly entityId: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly completed: boolean;
  readonly parent: string | null;
  readonly labels: readonly string[];

  constructor(init: {
    handle: string;
    entityId: string;
    title: string;
    body: string;
    status: string;
    completed: boolean;
    parent: string | null;
    labels: readonly string[];
  }) {
    this.handle = init.handle;
    this.entityId = init.entityId;
    this.title = init.title;
    this.body = init.body;
    this.status = init.status;
    this.completed = init.completed;
    this.parent = init.parent;
    this.labels = init.labels;
  }
}
