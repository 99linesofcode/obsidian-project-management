// A Todoist section (a lane) as fetched from the provider, in the shape the
// core needs. Sections are the Todoist twin of the GitHub board's status
// options (dt-07); the core maps lane name → section id in sync state, so the
// name is the identity the core reconciles on.
export interface TodoistSectionData {
  id: string;
  projectId: string;
  name: string;
}
