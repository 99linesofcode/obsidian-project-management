export class ProjectState {
  readonly handle: string;
  readonly updatedAt: string;
  readonly archived: boolean;

  constructor(init: { handle: string; updatedAt: string; archived: boolean }) {
    this.handle = init.handle;
    this.updatedAt = init.updatedAt;
    this.archived = init.archived;
  }
}
