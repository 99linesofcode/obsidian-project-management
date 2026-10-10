import { AdapterDescriptor } from '../../domain/AdapterDescriptor.js';
import { REQUIRED_CAPABILITIES } from '../../domain/Capabilities.js';

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
