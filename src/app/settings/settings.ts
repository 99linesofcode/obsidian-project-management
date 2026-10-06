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
};

// The pre-SecretStorage plaintext token fields. They are stripped on load and
// on save so a legacy data.json can never round-trip them back into the file
// after migration.
export const LEGACY_SECRET_FIELDS = ['githubToken', 'todoistToken'] as const;

const LEGACY_SECRET_FIELD_SET = new Set<string>(LEGACY_SECRET_FIELDS);

// Builds the in-memory settings from the data.json root, dropping the registry
// container. WHY: the root holds both settings and the sync-state registry under
// `syncState`; copying the whole root into settings would let a later settings
// save write a stale registry snapshot back over every write made since onload
// (REG-3). The legacy token fields are dropped too: they now live in
// SecretStorage, and a settings save must never write them back.
export function settingsFromData(
  data: Record<string, unknown>,
): ProjectManagementSettings {
  const settings: Record<string, unknown> = { ...data };
  delete settings[SYNC_STATE_KEY];
  for (const field of LEGACY_SECRET_FIELDS) {
    delete settings[field];
  }
  return Object.assign({}, DEFAULT_SETTINGS, settings);
}

// Merges the in-memory settings into a FRESH data.json read, so a registry
// write made after onload survives a settings save (REG-2/REG-3). The registry
// key is taken from the fresh read and never from the in-memory settings. The
// legacy token fields are stripped from both sides so they cannot survive a
// save.
export function mergeSettingsIntoData(
  data: Record<string, unknown>,
  settings: ProjectManagementSettings,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...data };
  for (const field of LEGACY_SECRET_FIELDS) {
    delete merged[field];
  }
  for (const [key, value] of Object.entries(settings)) {
    if (key === SYNC_STATE_KEY) continue;
    if (LEGACY_SECRET_FIELD_SET.has(key)) continue;
    merged[key] = value;
  }
  return merged;
}
