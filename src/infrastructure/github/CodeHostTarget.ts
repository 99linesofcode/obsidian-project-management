export interface StatusOption {
  readonly id: string;
  readonly name: string;
}

// The code host connection's declared target. An empty target is valid: the
// remote project is then identified by the vault project's name (ORG-2), and
// the adapter resolves the board by name.
export class CodeHostTarget {
  readonly target: string;

  constructor(init: { target: string }) {
    this.target = init.target;
  }

  static parse(raw: string): CodeHostTarget {
    return new CodeHostTarget({ target: raw.trim() });
  }
}
