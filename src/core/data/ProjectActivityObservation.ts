export class ProjectActivityObservation {
  readonly changed: boolean;
  readonly newestCreatedAt: string | null;
  readonly etag: string | null;

  constructor(init: {
    changed: boolean;
    newestCreatedAt: string | null;
    etag: string | null;
  }) {
    this.changed = init.changed;
    this.newestCreatedAt = init.newestCreatedAt;
    this.etag = init.etag;
  }
}
