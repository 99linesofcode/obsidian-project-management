import { AdapterDescriptor } from '../../core/AdapterDescriptor.js';
import {
  MANDATORY_FIELD_CAPABILITIES,
  UNIVERSAL_CAPABILITIES,
} from '../../core/Capabilities.js';

export function todoistDescriptor(): AdapterDescriptor {
  return new AdapterDescriptor({
    applicationId: 'todoist',
    capabilities: [
      ...UNIVERSAL_CAPABILITIES,
      ...MANDATORY_FIELD_CAPABILITIES,
      'capture',
      'trustworthy per-field timestamps',
      'complete-fetch',
    ],
    representations: {
      identity: 'native',
      title: 'native',
      body: 'native',
      Status: { mappedTo: 'section' },
      completion: { mappedTo: 'task-completed' },
      subtasks: { mappedTo: 'parent-task' },
      label: 'native',
    },
    secretKeys: ['todoist-token'],
    settingsRows: [],
  });
}
