export interface StatusOption {
  readonly id: string;
  readonly name: string;
}

export class CodeHostTarget {
  readonly repoUrl: string;

  constructor(init: { repoUrl: string }) {
    this.repoUrl = init.repoUrl;
  }

  static parse(raw: string): CodeHostTarget {
    const repoUrl = raw.trim();
    if (repoUrl === '') {
      throw new Error('code host target must carry a repository');
    }
    return new CodeHostTarget({ repoUrl });
  }
}
