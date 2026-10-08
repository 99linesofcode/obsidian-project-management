import { AdapterDescriptor } from '../../core/AdapterDescriptor.js';
import {
  MANDATORY_FIELD_CAPABILITIES,
  UNIVERSAL_CAPABILITIES,
} from '../../core/Capabilities.js';

export function conformanceDescriptor(applicationId: string): AdapterDescriptor {
  return new AdapterDescriptor({
    applicationId,
    capabilities: [
      ...UNIVERSAL_CAPABILITIES,
      ...MANDATORY_FIELD_CAPABILITIES,
      'capture',
      'task-locking',
      'project-activity',
      'trustworthy per-field timestamps',
      'complete-fetch',
    ],
    representations: {},
    secretKeys: [],
    settingsRows: [],
  });
}
