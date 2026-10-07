export interface StatusOption {
  readonly id: string;
  readonly name: string;
}

export class CodeHostTarget {
  readonly repoUrl: string;
  readonly projectNodeId: string;
  readonly statusFieldId: string;
  readonly statusOptions: readonly StatusOption[];

  constructor(init: {
    repoUrl: string;
    projectNodeId: string;
    statusFieldId: string;
    statusOptions: readonly StatusOption[];
  }) {
    this.repoUrl = init.repoUrl;
    this.projectNodeId = init.projectNodeId;
    this.statusFieldId = init.statusFieldId;
    this.statusOptions = init.statusOptions;
  }

  serialize(): string {
    return JSON.stringify({
      repoUrl: this.repoUrl,
      projectNodeId: this.projectNodeId,
      statusFieldId: this.statusFieldId,
      statusOptions: this.statusOptions,
    });
  }

  static parse(raw: string): CodeHostTarget {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error('code host target must be an object');
    }
    const repoUrl = parsed.repoUrl;
    const projectNodeId = parsed.projectNodeId;
    const statusFieldId = parsed.statusFieldId;
    if (
      typeof repoUrl !== 'string' ||
      typeof projectNodeId !== 'string' ||
      typeof statusFieldId !== 'string'
    ) {
      throw new Error('code host target is missing its repository or project');
    }
    return new CodeHostTarget({
      repoUrl,
      projectNodeId,
      statusFieldId,
      statusOptions: statusOptions(parsed.statusOptions),
    });
  }
}

function statusOptions(raw: unknown): readonly StatusOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRecord).flatMap((option) => {
    if (typeof option.id !== 'string' || typeof option.name !== 'string') {
      return [];
    }
    return [{ id: option.id, name: option.name }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
