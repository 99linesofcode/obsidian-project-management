import type { AdapterDescriptor } from '../AdapterDescriptor.js';
import type { MirrorAdapter } from '../ports/MirrorAdapter.js';

export class AdapterRegistration {
  readonly descriptor: AdapterDescriptor;
  readonly adapter: MirrorAdapter;

  constructor(descriptor: AdapterDescriptor, adapter: MirrorAdapter) {
    this.descriptor = descriptor;
    this.adapter = adapter;
  }
}
