// The GitHub identities a project note resolves to, in the shape the core
// needs. Node IDs are opaque GitHub identifiers; the core never sees raw
// GitHub JSON.
export interface ProjectStatusOption {
  id: string;
  name: string;
}

export interface ProjectIdentityData {
  repoNodeId: string;
  projectNodeId: string;
  statusFieldId: string;
  statusOptions: ProjectStatusOption[];
}
