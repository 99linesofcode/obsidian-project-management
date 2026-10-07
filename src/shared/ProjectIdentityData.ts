// The code-host identities a project note resolves to, in the shape the core
// needs. Node IDs are opaque code-host identifiers; the core never sees raw
// code-host JSON.
export interface ProjectStatusOption {
  id: string;
  name: string;
}

// The identity a project note resolves to: the repository and board addressing
// the core needs, plus the board's Status options. A value object, so every
// construction site goes through the constructor rather than hand-building the
// shape at a boundary. Named so a construction site reads as a record rather
// than a row of positional slots — the empty addressing of a board-less
// project is explicit, not a mystery argument.
export class ProjectIdentityData {
  repoUrl: string;
  repoNodeId: string;
  projectNodeId: string;
  statusFieldId: string;
  statusOptions: ProjectStatusOption[];

  constructor(init: ProjectIdentityData) {
    this.repoUrl = init.repoUrl;
    this.repoNodeId = init.repoNodeId;
    this.projectNodeId = init.projectNodeId;
    this.statusFieldId = init.statusFieldId;
    this.statusOptions = init.statusOptions;
  }
}
