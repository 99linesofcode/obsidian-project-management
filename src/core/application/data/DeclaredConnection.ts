import { ConnectionEnvelope } from './ConnectionEnvelope.js';

export class DeclaredConnection {
  readonly slug: string;
  readonly envelope: ConnectionEnvelope;

  constructor(init: { slug: string; envelope: ConnectionEnvelope }) {
    this.slug = init.slug;
    this.envelope = init.envelope;
  }
}
