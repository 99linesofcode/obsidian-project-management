import type { AdapterDescriptor } from './AdapterDescriptor.js';
import type { MirrorPort } from '../../port/MirrorPort.js';

export class RegisteredAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly adapter: MirrorPort;

  constructor(init: { descriptor: AdapterDescriptor; adapter: MirrorPort }) {
    this.descriptor = init.descriptor;
    this.adapter = init.adapter;
  }
}
