import { SYNC_STATE_KEY } from '../../registry/SyncStateAdapter.js';

export interface ProjectManagementSettings {
  githubToken: string;
  todoistToken: string;
  pollIntervalMinutes: number;
  doneOptionName: string;
  debounceSeconds: number;
  taskTemplatePath: string;
  todoTemplatePath: string;
}

export const DEFAULT_SETTINGS: ProjectManagementSettings = {
  githubToken: '',
  todoistToken: '',
  pollIntervalMinutes: 5,
  doneOptionName: 'Shipped',
  debounceSeconds: 5,
  taskTemplatePath: 'Templates/Task.md',
  todoTemplatePath: 'Templates/ToDo.md',
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
  return Object.assign({}, DEFAULT_SETTINGS, settings);
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
