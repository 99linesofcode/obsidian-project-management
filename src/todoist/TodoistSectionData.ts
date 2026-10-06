// The task-manager module's name for the remote section shape. The canonical
// interface lives in shared/RemoteSectionData so neutral modules can carry a
// remote section without naming the provider; this alias keeps the
// provider-facing vocabulary local to the provider module.
export type { RemoteSectionData as TodoistSectionData } from '../shared/RemoteSectionData.js';
