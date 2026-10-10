import type { CanonicalField } from './canonicalField.js';
import type { Capability } from './Capabilities.js';

export type Representation = 'native' | { readonly mappedTo: string };

export type SettingsRowKind = 'text' | 'toggle' | 'number' | 'list';

export class SettingsRow {
  readonly key: string;
  readonly label: string;
  readonly kind: SettingsRowKind;
  readonly default: string | boolean | number | readonly string[];

  constructor(init: {
    key: string;
    label: string;
    kind: SettingsRowKind;
    default: string | boolean | number | readonly string[];
  }) {
    this.key = init.key;
    this.label = init.label;
    this.kind = init.kind;
    this.default = init.default;
  }
}

export class AdapterDescriptor {
  readonly applicationId: string;
  readonly capabilities: readonly Capability[];
  readonly representations: Partial<Record<CanonicalField, Representation>>;
  readonly secretKeys: readonly string[];
  readonly settingsRows: readonly SettingsRow[];

  constructor(init: {
    applicationId: string;
    capabilities: readonly Capability[];
    representations: Partial<Record<CanonicalField, Representation>>;
    secretKeys: readonly string[];
    settingsRows: readonly SettingsRow[];
  }) {
    this.applicationId = init.applicationId;
    this.capabilities = init.capabilities;
    this.representations = init.representations;
    this.secretKeys = init.secretKeys;
    this.settingsRows = init.settingsRows;
  }

  represents(field: CanonicalField): boolean {
    return (
      this.representations[field] !== undefined ||
      this.capabilities.includes(field)
    );
  }
}
