export class ProjectSummary {
  readonly handle: string;
  readonly name: string;

  constructor(init: { handle: string; name: string }) {
    this.handle = init.handle;
    this.name = init.name;
  }
}
