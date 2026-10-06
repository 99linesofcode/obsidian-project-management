// A task-manager section (a lane) as fetched from the provider, in the shape
// the core needs. Sections are the task-manager twin of the code-host board's
// status options (dt-07); the core maps lane name → section id in sync state,
// so the name is the identity the core reconciles on.
export interface RemoteSectionData {
  id: string;
  projectId: string;
  name: string;
}
