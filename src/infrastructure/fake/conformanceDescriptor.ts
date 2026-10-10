import { AdapterDescriptor } from '../../core/AdapterDescriptor.js';
import { REQUIRED_CAPABILITIES } from '../../core/Capabilities.js';

export function conformanceDescriptor(
  applicationId: string,
): AdapterDescriptor {
  return new AdapterDescriptor({
    applicationId,
    capabilities: [
      ...REQUIRED_CAPABILITIES,
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
