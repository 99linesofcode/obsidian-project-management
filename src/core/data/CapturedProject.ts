export class CapturedProject {
  readonly name: string;
  readonly targets: readonly string[];
  readonly createdAt: string | null;

  constructor(init: {
    name: string;
    targets: readonly string[];
    createdAt: string | null;
  }) {
    this.name = init.name;
    this.targets = init.targets;
    this.createdAt = init.createdAt;
  }
}
