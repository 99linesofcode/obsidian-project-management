import type { Capability } from '../../domain/capabilities.js';
import type { SettingsRow } from './SettingsRow.js';

export class AdapterDescriptor {
  readonly applicationId: string;
  readonly capabilities: readonly Capability[];
  readonly secretKeys: readonly string[];
  readonly settingsRows: readonly SettingsRow[];

  constructor(init: {
    applicationId: string;
    capabilities: readonly Capability[];
    secretKeys: readonly string[];
    settingsRows: readonly SettingsRow[];
  }) {
    this.applicationId = init.applicationId;
    this.capabilities = init.capabilities;
    this.secretKeys = init.secretKeys;
    this.settingsRows = init.settingsRows;
  }
}
