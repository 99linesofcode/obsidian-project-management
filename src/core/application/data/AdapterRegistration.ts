import type { AdapterDescriptor } from './AdapterDescriptor.js';
import type { MirrorPort } from '../../port/MirrorPort.js';

export class AdapterRegistration {
  readonly descriptor: AdapterDescriptor;
  readonly adapter: MirrorPort;

  constructor(descriptor: AdapterDescriptor, adapter: MirrorPort) {
    this.descriptor = descriptor;
    this.adapter = adapter;
  }
}
