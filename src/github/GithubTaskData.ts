// The code-host module's name for the remote issue shape. The canonical
// interface lives in shared/CodeHostTaskData so neutral modules can carry a
// code-host task without naming the provider; this alias keeps the
// provider-facing vocabulary local to the provider module.
export type { CodeHostTaskData as GithubTaskData } from '../shared/CodeHostTaskData.js';
