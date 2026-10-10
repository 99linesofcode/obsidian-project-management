export class AdoptedProject {
  readonly projectName: string;
  readonly application: string;
  readonly target: string;

  constructor(init: {
    projectName: string;
    application: string;
    target: string;
  }) {
    this.projectName = init.projectName;
    this.application = init.application;
    this.target = init.target;
  }
}
