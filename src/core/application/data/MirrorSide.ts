import type { RegisteredAdapter } from './RegisteredAdapter.js';

export class MirrorSide {
  readonly side: string;
  readonly handle: string;
  readonly adapter: RegisteredAdapter;

  constructor(init: {
    side: string;
    handle: string;
    adapter: RegisteredAdapter;
  }) {
    this.side = init.side;
    this.handle = init.handle;
    this.adapter = init.adapter;
  }
}
