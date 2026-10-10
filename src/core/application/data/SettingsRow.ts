export type SettingsRowKind = 'text' | 'toggle' | 'number' | 'list';

export class SettingsRow {
  readonly key: string;
  readonly label: string;
  readonly kind: SettingsRowKind;
  readonly description?: string;

  constructor(init: {
    key: string;
    label: string;
    kind: SettingsRowKind;
    description?: string;
  }) {
    this.key = init.key;
    this.label = init.label;
    this.kind = init.kind;
    if (init.description !== undefined) {
      this.description = init.description;
    }
  }
}
