import { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';

// A canonical task with sensible defaults, so a reconciliation scenario names
// only the fields it moves. The constructor is positional, so the defaults live
// here once.
export function taskData(overrides: Partial<TaskData> = {}): TaskData {
  const base = new TaskData(
    'task-1',
    'Projecten/Acme Widgets/taken/fix-the-bug.md',
    { github: 'https://github.com/acme/widgets/issues/42' },
    'Fix the bug',
    'hash-of-the-body',
    'Building',
    null,
    'task',
    null,
    '2026-09-18T10:00:00Z',
    '2026-09-18T10:00:00Z',
  );
  return Object.assign(base, overrides);
}
