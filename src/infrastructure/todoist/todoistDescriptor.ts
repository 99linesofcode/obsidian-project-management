import { AdapterDescriptor } from '../../core/application/data/AdapterDescriptor.js';
import { SettingsRow } from '../../core/application/data/SettingsRow.js';
import { REQUIRED_CAPABILITIES } from '../../core/domain/capabilities.js';

export function todoistDescriptor(): AdapterDescriptor {
  return new AdapterDescriptor({
    applicationId: 'todoist',
    capabilities: [
      ...REQUIRED_CAPABILITIES,
      'capture',
      'trustworthy per-field timestamps',
      'complete-fetch',
    ],
    representations: {
      title: 'native',
      body: 'native',
      Status: { mappedTo: 'section' },
      completion: { mappedTo: 'task-completed' },
      subtasks: { mappedTo: 'parent-task' },
      label: 'native',
    },
    secretKeys: ['todoist-token'],
    settingsRows: [
      new SettingsRow({
        key: 'todoist-token',
        label: 'Todoist token',
        kind: 'text',
        description: 'Personal API token used to talk to the Todoist API.',
      }),
    ],
  });
}
