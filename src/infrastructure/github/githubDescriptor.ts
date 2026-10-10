import {
  AdapterDescriptor,
  SettingsRow,
} from '../../core/AdapterDescriptor.js';
import {
  MANDATORY_FIELD_CAPABILITIES,
  UNIVERSAL_CAPABILITIES,
} from '../../core/Capabilities.js';

export function githubDescriptor(): AdapterDescriptor {
  return new AdapterDescriptor({
    applicationId: 'github',
    capabilities: [
      ...UNIVERSAL_CAPABILITIES,
      ...MANDATORY_FIELD_CAPABILITIES,
      'capture',
      'task-locking',
      'project-activity',
      'trustworthy per-field timestamps',
      'complete-fetch',
    ],
    representations: {
      identity: 'native',
      title: 'native',
      body: 'native',
      Status: { mappedTo: 'board-status' },
      completion: { mappedTo: 'issue-state' },
      subtasks: { mappedTo: 'parent-issue' },
      label: 'native',
    },
    secretKeys: ['github-token'],
    settingsRows: [
      new SettingsRow({
        key: 'github-token',
        label: 'GitHub token',
        kind: 'text',
        description: 'Personal access token used to talk to the GitHub API.',
      }),
    ],
  });
}
