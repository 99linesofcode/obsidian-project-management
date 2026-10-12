import type { MirrorPort } from '../../port/MirrorPort.js';

export class MirrorSide {
  readonly side: string;
  readonly handle: string;
  readonly adapter: MirrorPort;

  constructor(init: { side: string; handle: string; adapter: MirrorPort }) {
    this.side = init.side;
    this.handle = init.handle;
    this.adapter = init.adapter;
  }
}
