import { SYNC_STATE_KEY } from '../../registry/SyncStateAdapter.js';

export interface ProjectManagementSettings {
  pollIntervalMinutes: number;
  doneOptionName: string;
  debounceSeconds: number;
  // The six vault artifacts the plugin assumes exist: three note templates and
  // three Bases files. Each is seeded create-if-missing at its configured path
  // on init, and scaffoldable on demand from the settings tab.
  projectTemplatePath: string;
  taskTemplatePath: string;
  todoTemplatePath: string;
  projectsBasePath: string;
  tasksBasePath: string;
  todosBasePath: string;
  // The Status lane vocabulary a CREATED board's Status field gets. An adopted
  // board keeps its own options, so this governs creation only.
  statusOptions: string[];
  // The type-label vocabulary the seed action applies to a repository.
  typeLabels: string[];
}

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

// Builds the in-memory settings from the data.json root, dropping the registry
// container. WHY: the root holds both settings and the sync-state registry under
// `syncState`; copying the whole root into settings would let a later settings
// save write a stale registry snapshot back over every write made since onload
// (REG-3).
export function settingsFromData(
  data: Record<string, unknown>,
): ProjectManagementSettings {
  const settings: Record<string, unknown> = { ...data };
  delete settings[SYNC_STATE_KEY];
  const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
  // The two list settings are cloned so a caller that edits one in place can
  // never mutate DEFAULT_SETTINGS for the rest of the process.
  merged.statusOptions = [...merged.statusOptions];
  merged.typeLabels = [...merged.typeLabels];
  return merged;
}

// Merges the in-memory settings into a FRESH data.json read, so a registry
// write made after onload survives a settings save (REG-2/REG-3). The registry
// key is taken from the fresh read and never from the in-memory settings.
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
