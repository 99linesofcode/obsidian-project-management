export class ConnectionDataTransferObject {
  readonly slug: string;
  readonly application: string;
  readonly target: string;

  constructor(init: { slug: string; application: string; target: string }) {
    this.slug = init.slug;
    this.application = init.application;
    this.target = init.target;
  }
}
