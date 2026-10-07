export class CanonicalProject {
  readonly handle: string;
  readonly name: string;
  readonly archived: boolean;

  constructor(init: {
    handle: string;
    name: string;
    archived: boolean;
  }) {
    this.handle = init.handle;
    this.name = init.name;
    this.archived = init.archived;
  }
}
