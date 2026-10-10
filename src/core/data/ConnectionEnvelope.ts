export class ConnectionEnvelope {
  readonly application: string;
  readonly target: string;

  constructor(init: { application: string; target: string }) {
    this.application = init.application;
    this.target = init.target;
  }
}
