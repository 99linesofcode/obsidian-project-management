import { SYNC_STATE_KEY } from '../../infrastructure/registry/SyncStateAdapter.js';
import type { ProjectManagementSettings } from '../../core/application/data/ProjectManagementSettings.js';

export const DEFAULT_SETTINGS: ProjectManagementSettings = {
  pollIntervalMinutes: 5,
  doneOptionName: 'Shipped',
  debounceSeconds: 5,
  projectTemplatePath: 'Templates/Project.md',
  taskTemplatePath: 'Templates/Task.md',
  todoTemplatePath: 'Templates/ToDo.md',
  projectsBasePath: 'Bases/Projects.base',
  tasksBasePath: 'Bases/Tasks.base',
  todosBasePath: 'Bases/Todos.base',
  statusOptions: ['Unshaped', 'Shaping', 'Shaped', 'Building', 'Shipped'],
  typeLabels: [
    'type: bug',
    'type: chore',
    'type: pitch',
    'type: slice',
    'type: task',
  ],
};

export function settingsFromData(
  data: Record<string, unknown>,
): ProjectManagementSettings {
  const settings: Record<string, unknown> = { ...data };
  delete settings[SYNC_STATE_KEY];
  const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
  merged.statusOptions = [...merged.statusOptions];
  merged.typeLabels = [...merged.typeLabels];
  return merged;
}

export function mergeSettingsIntoData(
  data: Record<string, unknown>,
  settings: ProjectManagementSettings,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(settings)) {
    if (key === SYNC_STATE_KEY) continue;
    merged[key] = value;
  }
  return merged;
}
