export interface StatusOption {
  readonly id: string;
  readonly name: string;
}

export class GithubTarget {
  readonly target: string;

  constructor(init: { target: string }) {
    this.target = init.target;
  }

  static parse(raw: string): GithubTarget {
    return new GithubTarget({ target: raw.trim() });
  }
}
