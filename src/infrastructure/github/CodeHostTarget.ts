export interface StatusOption {
  readonly id: string;
  readonly name: string;
}

export class CodeHostTarget {
  readonly target: string;

  constructor(init: { target: string }) {
    this.target = init.target;
  }

  static parse(raw: string): CodeHostTarget {
    const target = raw.trim();
    if (target === '') {
      throw new Error('code host target must carry a repository');
    }
    return new CodeHostTarget({ target });
  }
}
