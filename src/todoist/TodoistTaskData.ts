// The task-manager module's name for the remote task shape. The canonical
// interface lives in shared/RemoteTaskData so neutral modules can carry a
// remote task without naming the provider; this alias keeps the
// provider-facing vocabulary local to the provider module.
export type { RemoteTaskData as TodoistTaskData } from '../shared/RemoteTaskData.js';
