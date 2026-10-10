import type { CanonicalField } from '../canonicalField.js';
import type { Capability } from '../capabilities.js';
import type { SettingsRow } from './SettingsRow.js';

export type Representation = 'native' | { readonly mappedTo: string };

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
