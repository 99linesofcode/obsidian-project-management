// The task-manager module's name for the remote project shape. The canonical
// interface lives in shared/RemoteProjectData so neutral modules can carry a
// remote project without naming the provider; this alias keeps the
// provider-facing vocabulary local to the provider module.
export type { RemoteProjectData as TodoistProjectData } from '../shared/RemoteProjectData.js';
