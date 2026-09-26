import type { TaskData } from '../../src/Domain/DataTransferObjects/TaskData.js';

// A canonical snapshot record with sensible defaults, so a test names only the
// fields it cares about. One builder for both the GitHub (`status.<url>`) and
// Todoist (`todoistItem.<notePath>`) namespaces — the record shape is uniform.
export function taskRecord(overrides: Partial<TaskData> = {}): TaskData {
  return {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: '',
    todoistId: '',
    notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    title: 'Fix the bug',
    body: '',
    status: '',
    completed: false,
    parent: null,
    labels: [],
    updatedAt: '',
    ...overrides,
  };
}
